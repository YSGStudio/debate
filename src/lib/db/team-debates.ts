import "server-only";
import { admin } from "@/lib/supabase/admin";
import { UNIQUE_VIOLATION } from "./types";
import type { Side, StagePhase, TeamPhase } from "@/lib/team/rules";

/**
 * 팀 토론 DB 접근 (ver2 PRD). 차례·잠금·시간 판정은 SQL 함수(0006)가 한다.
 * 여기서는 그 함수를 부르고, 단순 조회·갱신만 한다.
 */

export type TeamStatus = "draft" | "open" | "closed";
export type ScoreVisibility = "live" | "after_end";

export interface TeamDebateRow {
  id: string;
  class_id: string;
  topic: string;
  description: string | null;
  grade_level: number;
  status: TeamStatus;
  phase: TeamPhase;
  pro_name: string;
  con_name: string;
  stage_seconds: Record<StagePhase, number>;
  turn_seconds: number;
  score_visibility: ScoreVisibility;
  speaker_balance: boolean;
  phase_started_at: string | null;
  phase_deadline_at: string | null;
  paused_at: string | null;
  results_published_at: string | null;
  opened_at: string | null;
  closed_at: string | null;
  archived_at: string | null;
  created_at: string;
}

const COLS =
  "id, class_id, topic, description, grade_level, status, phase, pro_name, con_name, stage_seconds, turn_seconds, score_visibility, speaker_balance, phase_started_at, phase_deadline_at, paused_at, results_published_at, opened_at, closed_at, archived_at, created_at";

export interface TeamDebateInput {
  topic: string;
  description: string | null;
  proName: string;
  conName: string;
  stageSeconds: Record<StagePhase, number>;
  turnSeconds: number;
  scoreVisibility: ScoreVisibility;
  speakerBalance: boolean;
}

function toRow(input: Partial<TeamDebateInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.topic !== undefined) row.topic = input.topic;
  if (input.description !== undefined) row.description = input.description;
  if (input.proName !== undefined) row.pro_name = input.proName;
  if (input.conName !== undefined) row.con_name = input.conName;
  if (input.stageSeconds !== undefined) row.stage_seconds = input.stageSeconds;
  if (input.turnSeconds !== undefined) row.turn_seconds = input.turnSeconds;
  if (input.scoreVisibility !== undefined) row.score_visibility = input.scoreVisibility;
  if (input.speakerBalance !== undefined) row.speaker_balance = input.speakerBalance;
  return row;
}

/** 생성. 학급 학년을 스냅샷한다 (V-R2). */
export async function createTeamDebate(
  classId: string,
  gradeLevel: number,
  input: TeamDebateInput,
): Promise<TeamDebateRow> {
  const { data, error } = await admin()
    .from("team_debates")
    .insert({ class_id: classId, grade_level: gradeLevel, status: "draft", ...toRow(input) })
    .select(COLS)
    .single();
  if (error) throw new Error(`팀 토론 생성 실패: ${error.message}`);
  return data as TeamDebateRow;
}

/** draft 에서만 수정 (V-R2) */
export async function updateDraftTeamDebate(
  debateId: string,
  input: Partial<TeamDebateInput> & { gradeLevel?: number },
): Promise<TeamDebateRow | null> {
  const row = toRow(input);
  if (input.gradeLevel !== undefined) row.grade_level = input.gradeLevel;
  const { data } = await admin()
    .from("team_debates")
    .update(row)
    .eq("id", debateId)
    .eq("status", "draft")
    .select(COLS)
    .maybeSingle();
  return (data as TeamDebateRow) ?? null;
}

/** 보관하지 않은 팀 토론 */
export async function listTeamDebates(classId: string): Promise<TeamDebateRow[]> {
  const { data } = await admin()
    .from("team_debates")
    .select(COLS)
    .eq("class_id", classId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as TeamDebateRow[];
}

export async function getTeamDebate(debateId: string): Promise<TeamDebateRow | null> {
  const { data } = await admin().from("team_debates").select(COLS).eq("id", debateId).maybeSingle();
  return (data as TeamDebateRow) ?? null;
}

/** 소유권 검사를 겸한 조회. 남의 것이면 null → 404 (R4) */
export async function getOwnedTeamDebate(
  teacherId: string,
  debateId: string,
): Promise<{ debate: TeamDebateRow; className: string } | null> {
  const { data } = await admin()
    .from("team_debates")
    .select(`${COLS}, classes!inner(name, teacher_id)`)
    .eq("id", debateId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as TeamDebateRow & { classes: { name: string; teacher_id: string } };
  if (row.classes.teacher_id !== teacherId) return null;
  const { classes, ...debate } = row;
  return { debate: debate as TeamDebateRow, className: classes.name };
}

/** 보관함의 팀 토론. 학급이 살아 있는 것만 (학급째 보관되면 학급 항목으로 본다) */
export async function listArchivedTeamDebates(
  teacherId: string,
): Promise<(TeamDebateRow & { class_name: string })[]> {
  const { data } = await admin()
    .from("team_debates")
    .select(`${COLS}, classes!inner(name, teacher_id, archived_at)`)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });
  const rows = (data ?? []) as unknown as (TeamDebateRow & {
    classes: { name: string; teacher_id: string; archived_at: string | null };
  })[];
  return rows
    .filter((r) => r.classes.teacher_id === teacherId && r.classes.archived_at === null)
    .map((r) => ({ ...r, class_name: r.classes.name }));
}

/** 학급 보관·삭제 판단용: 열린 팀 토론 주제 (V-R5) */
export async function listOpenTeamDebateTopics(classId: string): Promise<string[]> {
  const { data } = await admin()
    .from("team_debates")
    .select("topic")
    .eq("class_id", classId)
    .eq("status", "open");
  return ((data ?? []) as { topic: string }[]).map((r) => r.topic);
}

/** 학생에게 보이는 팀 토론: 자기가 배정된 open 토론만 (V-R6) */
export async function listOpenTeamDebatesForStudent(
  classId: string,
  studentId: string,
): Promise<{ id: string; topic: string; side: Side }[]> {
  const { data } = await admin()
    .from("team_members")
    .select("side, team_debates!inner(id, topic, class_id, status, archived_at)")
    .eq("student_id", studentId)
    .eq("team_debates.class_id", classId)
    .eq("team_debates.status", "open")
    .is("team_debates.archived_at", null);
  const rows = (data ?? []) as unknown as {
    side: Side;
    team_debates: { id: string; topic: string };
  }[];
  return rows.map((r) => ({ id: r.team_debates.id, topic: r.team_debates.topic, side: r.side }));
}

// ── 상태 전이 ───────────────────────────────────────────────────────────────

export type OpenResult = "opened" | "conflict" | "not_draft" | "not_found";

export async function openTeamDebateAtomic(
  debateId: string,
): Promise<{ result: OpenResult; conflictTopic: string | null }> {
  const { data, error } = await admin().rpc("open_team_debate_atomic", { p_debate_id: debateId });
  if (error) throw new Error(`입장 열기 실패: ${error.message}`);
  const row = ((data ?? []) as { result: OpenResult; conflict_topic: string | null }[])[0];
  if (!row) return { result: "not_found", conflictTopic: null };
  return { result: row.result, conflictTopic: row.conflict_topic };
}

export type ControlAction = "start" | "next" | "pause" | "resume" | "extend" | "end";

export async function teamControl(
  debateId: string,
  action: ControlAction,
): Promise<"ok" | "invalid" | "not_found"> {
  const { data, error } = await admin().rpc("team_control", { p_debate_id: debateId, p_action: action });
  if (error) throw new Error(`진행 제어 실패: ${error.message}`);
  return data as "ok" | "invalid" | "not_found";
}

export async function publishTeamResults(debateId: string): Promise<boolean> {
  const { data } = await admin()
    .from("team_debates")
    .update({ results_published_at: new Date().toISOString() })
    .eq("id", debateId)
    .eq("status", "closed")
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

export async function archiveTeamDebate(debateId: string): Promise<boolean> {
  const { data } = await admin()
    .from("team_debates")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", debateId)
    .neq("status", "open")
    .is("archived_at", null)
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

export async function restoreTeamDebate(debateId: string): Promise<boolean> {
  const { data } = await admin()
    .from("team_debates")
    .update({ archived_at: null })
    .eq("id", debateId)
    .not("archived_at", "is", null)
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

/** 완전 삭제. 보관된 것만, open 이 아닌 것만 — DB 조건으로도 막는다 (R68, R70) */
export async function deleteTeamDebate(debateId: string): Promise<boolean> {
  const { data } = await admin()
    .from("team_debates")
    .delete()
    .eq("id", debateId)
    .neq("status", "open")
    .not("archived_at", "is", null)
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

export interface TeamDebateImpact {
  topic: string;
  status: TeamStatus;
  memberCount: number;
  speechCount: number;
  chatCount: number;
  scoredCount: number;
}

/** 완전 삭제 미리보기 (V-R5) */
export async function teamDebateDeletionImpact(debate: TeamDebateRow): Promise<TeamDebateImpact> {
  const count = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const [memberCount, speechCount, chatCount, scoredCount] = await Promise.all([
    count(admin().from("team_members").select("id", { count: "exact", head: true }).eq("debate_id", debate.id)),
    count(
      admin().from("team_messages").select("id", { count: "exact", head: true })
        .eq("debate_id", debate.id).eq("kind", "speech"),
    ),
    count(
      admin().from("team_messages").select("id", { count: "exact", head: true })
        .eq("debate_id", debate.id).in("kind", ["chat", "draft"]),
    ),
    count(
      admin().from("team_speech_scores").select("id", { count: "exact", head: true })
        .eq("debate_id", debate.id).eq("status", "done"),
    ),
  ]);
  return { topic: debate.topic, status: debate.status, memberCount, speechCount, chatCount, scoredCount };
}

// ── 배정 ────────────────────────────────────────────────────────────────────

export interface TeamMemberView {
  id: string;
  student_id: string;
  side: Side;
  alias: string;
  speech_count: number;
  display_name: string;
}

export async function listTeamMembers(debateId: string): Promise<TeamMemberView[]> {
  const { data } = await admin()
    .from("team_members")
    .select("id, student_id, side, alias, speech_count, students!inner(display_name)")
    .eq("debate_id", debateId)
    .order("alias");
  const rows = (data ?? []) as unknown as (Omit<TeamMemberView, "display_name"> & {
    students: { display_name: string };
  })[];
  return rows.map(({ students, ...m }) => ({ ...m, display_name: students.display_name }));
}

export async function setTeamMembers(
  debateId: string,
  members: { studentId: string; side: Side }[],
): Promise<"ok" | "invalid" | "invalid_student" | "not_found"> {
  const { data, error } = await admin().rpc("team_set_members", {
    p_debate_id: debateId,
    p_members: members,
  });
  if (error) throw new Error(`팀 배정 실패: ${error.message}`);
  return data as "ok" | "invalid" | "invalid_student" | "not_found";
}

// ── 학생 쪽 RPC ─────────────────────────────────────────────────────────────

export interface StudentIdentity {
  classId: string;
  studentId: string;
  deviceId: string | null;
}

function ident(debateId: string, s: StudentIdentity) {
  return { p_debate_id: debateId, p_class_id: s.classId, p_student_id: s.studentId, p_device: s.deviceId };
}

export async function teamEnter(debateId: string, s: StudentIdentity & { deviceId: string }): Promise<string> {
  const { data, error } = await admin().rpc("team_enter", ident(debateId, s));
  if (error) throw new Error(`입장 실패: ${error.message}`);
  return data as string;
}

export async function teamClaim(
  debateId: string,
  s: StudentIdentity,
): Promise<{ result: string; holder: string | null }> {
  const { data, error } = await admin().rpc("team_claim", ident(debateId, s));
  if (error) throw new Error(`잠금 실패: ${error.message}`);
  const row = ((data ?? []) as { result: string; holder: string | null }[])[0];
  return row ?? { result: "not_found", holder: null };
}

export async function teamSpeak(
  debateId: string,
  s: StudentIdentity,
  content: string,
): Promise<{ result: string; messageId: string | null; seq: number | null }> {
  const { data, error } = await admin().rpc("team_speak", { ...ident(debateId, s), p_content: content });
  if (error) throw new Error(`발언 저장 실패: ${error.message}`);
  const row = ((data ?? []) as { result: string; message_id: string | null; seq: number | null }[])[0];
  return row ? { result: row.result, messageId: row.message_id, seq: row.seq } : { result: "not_found", messageId: null, seq: null };
}

export async function teamChat(
  debateId: string,
  s: StudentIdentity,
  content: string,
  draft: boolean,
): Promise<{ result: string; messageId: string | null }> {
  const { data, error } = await admin().rpc("team_chat", {
    ...ident(debateId, s),
    p_content: content,
    p_draft: draft,
  });
  if (error) throw new Error(`팀 채팅 저장 실패: ${error.message}`);
  const row = ((data ?? []) as { result: string; message_id: string | null }[])[0];
  return row ? { result: row.result, messageId: row.message_id } : { result: "not_found", messageId: null };
}

export type PollViewer =
  | { role: "teacher"; teacherId: string }
  | { role: "student"; classId: string; studentId: string; deviceId: string | null };

/** 폴링 1회 = RPC 1회 (V-R49) */
export async function teamPoll(debateId: string, viewer: PollViewer, since: number): Promise<Record<string, unknown>> {
  const { data, error } = await admin().rpc("team_poll", {
    p_debate_id: debateId,
    p_viewer: viewer,
    p_since: since,
  });
  if (error) throw new Error(`폴링 실패: ${error.message}`);
  return (data ?? { error: "not_found" }) as Record<string, unknown>;
}

// ── 교사 메시지·숨김·알림 ────────────────────────────────────────────────────

export async function appendTeacherMessage(
  debate: TeamDebateRow,
  kind: "announcement" | "teacher_warning",
  channel: "floor" | Side,
  content: string,
): Promise<{ id: string; seq: number }> {
  const { data, error } = await admin().rpc("team_append", {
    p_debate_id: debate.id,
    p_channel: channel,
    p_kind: kind,
    p_phase: debate.phase,
    p_turn_id: null,
    p_member_id: null,
    p_side: channel === "floor" ? null : channel,
    p_content: content,
  });
  if (error) throw new Error(`메시지 저장 실패: ${error.message}`);
  const row = data as { id: string; seq: number };
  return { id: row.id, seq: row.seq };
}

/** 전체 토론방 발언 숨김/되돌리기 (V-R17). 발언만 대상이다. */
export async function setSpeechHidden(debateId: string, messageId: string, hidden: boolean): Promise<boolean> {
  const { data } = await admin()
    .from("team_messages")
    .update({ hidden_at: hidden ? new Date().toISOString() : null })
    .eq("id", messageId)
    .eq("debate_id", debateId)
    .eq("kind", "speech")
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

export async function acknowledgeTeamAlert(debateId: string, alertId: string): Promise<boolean> {
  const { data } = await admin()
    .from("team_alerts")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", alertId)
    .eq("debate_id", debateId)
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

export async function insertInappropriateAlert(input: {
  debateId: string;
  messageId: string;
  memberId: string | null;
  side: Side | null;
  detail: string;
}): Promise<void> {
  await admin().from("team_alerts").insert({
    debate_id: input.debateId,
    kind: "inappropriate",
    message_id: input.messageId,
    member_id: input.memberId,
    side: input.side,
    detail: input.detail,
  });
}

// ── 메시지 조회 (채점·결과·PDF) ─────────────────────────────────────────────

export interface TeamMessageRow {
  id: string;
  debate_id: string;
  seq: number;
  channel: "floor" | Side;
  kind: string;
  phase: TeamPhase;
  side: Side | null;
  member_id: string | null;
  content: string;
  hidden_at: string | null;
  created_at: string;
}

const MSG_COLS = "id, debate_id, seq, channel, kind, phase, side, member_id, content, hidden_at, created_at";

export async function getTeamMessage(messageId: string): Promise<TeamMessageRow | null> {
  const { data } = await admin().from("team_messages").select(MSG_COLS).eq("id", messageId).maybeSingle();
  return (data as TeamMessageRow) ?? null;
}

/** 전체 토론방 기록 (발언·패스·시스템·공지). 채팅은 넣지 않는다. */
export async function listFloorMessages(debateId: string): Promise<TeamMessageRow[]> {
  const { data } = await admin()
    .from("team_messages")
    .select(MSG_COLS)
    .eq("debate_id", debateId)
    .eq("channel", "floor")
    .order("seq");
  return (data ?? []) as TeamMessageRow[];
}

// ── 발언 채점 ───────────────────────────────────────────────────────────────

export interface SpeechScoreRow {
  id: string;
  message_id: string;
  debate_id: string;
  status: "pending" | "done" | "failed" | "skipped";
  logic: number | null;
  evidence: number | null;
  response: number | null;
  phase_fit: number | null;
  attitude: number | null;
  total: number | null;
  reason: string | null;
  responded_to_seq: number | null;
  edited_by: string | null;
  edited_at: string | null;
  model: string | null;
  attempts: number;
  error: string | null;
}

const SCORE_COLS =
  "id, message_id, debate_id, status, logic, evidence, response, phase_fit, attitude, total, reason, responded_to_seq, edited_by, edited_at, model, attempts, error";

/**
 * 채점 착수권 (V-R37). unique(message_id) 로 한 번만 성공한다.
 * 동시에 두 요청이 와도 모델 호출은 한 번이다.
 */
export async function claimSpeechScore(messageId: string, debateId: string): Promise<boolean> {
  const { error } = await admin()
    .from("team_speech_scores")
    .insert({ message_id: messageId, debate_id: debateId, status: "pending", attempts: 1 });
  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  throw new Error(`채점 착수 실패: ${error.message}`);
}

/** 교사의 "다시 채점". failed 이고 교사가 고치지 않은 것만 다시 잡는다 (V-R35, V-R36) */
export async function reclaimSpeechScore(scoreId: string): Promise<SpeechScoreRow | null> {
  const { data: cur } = await admin().from("team_speech_scores").select(SCORE_COLS).eq("id", scoreId).maybeSingle();
  if (!cur) return null;
  const row = cur as SpeechScoreRow;
  const { data } = await admin()
    .from("team_speech_scores")
    .update({ status: "pending", attempts: row.attempts + 1, error: null, updated_at: new Date().toISOString() })
    .eq("id", scoreId)
    .eq("status", "failed")
    .is("edited_at", null)
    .select(SCORE_COLS)
    .maybeSingle();
  return (data as SpeechScoreRow) ?? null;
}

/** 채점 결과 저장. 교사가 이미 고친 점수는 덮지 않는다 (V-R36) */
export async function saveSpeechScore(
  messageId: string,
  s: {
    logic: number; evidence: number; response: number; phaseFit: number; attitude: number;
    total: number; reason: string; respondedToSeq: number | null; model: string;
  },
): Promise<boolean> {
  const { data } = await admin()
    .from("team_speech_scores")
    .update({
      status: "done",
      logic: s.logic,
      evidence: s.evidence,
      response: s.response,
      phase_fit: s.phaseFit,
      attitude: s.attitude,
      total: s.total,
      reason: s.reason,
      responded_to_seq: s.respondedToSeq,
      model: s.model,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("message_id", messageId)
    .is("edited_at", null)
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

export async function failSpeechScore(messageId: string, error: string): Promise<void> {
  await admin()
    .from("team_speech_scores")
    .update({ status: "failed", error, updated_at: new Date().toISOString() })
    .eq("message_id", messageId)
    .is("edited_at", null);
}

export async function getSpeechScore(scoreId: string): Promise<SpeechScoreRow | null> {
  const { data } = await admin().from("team_speech_scores").select(SCORE_COLS).eq("id", scoreId).maybeSingle();
  return (data as SpeechScoreRow) ?? null;
}

export async function listSpeechScores(debateId: string): Promise<SpeechScoreRow[]> {
  const { data } = await admin().from("team_speech_scores").select(SCORE_COLS).eq("debate_id", debateId);
  return (data ?? []) as SpeechScoreRow[];
}

/** 교사 수정 + 이력 (V-R36) */
export async function editSpeechScore(
  score: SpeechScoreRow,
  teacherId: string,
  next: { logic: number; evidence: number; response: number; phaseFit: number; attitude: number; total: number },
): Promise<SpeechScoreRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await admin()
    .from("team_speech_scores")
    .update({
      status: "done",
      logic: next.logic,
      evidence: next.evidence,
      response: next.response,
      phase_fit: next.phaseFit,
      attitude: next.attitude,
      total: next.total,
      edited_by: teacherId,
      edited_at: now,
      error: null,
      updated_at: now,
    })
    .eq("id", score.id)
    .select(SCORE_COLS)
    .maybeSingle();
  if (error || !data) return null;

  await admin().from("team_score_edits").insert({
    score_id: score.id,
    teacher_id: teacherId,
    before: {
      status: score.status, logic: score.logic, evidence: score.evidence, response: score.response,
      phaseFit: score.phase_fit, attitude: score.attitude, total: score.total,
    },
    after: next,
  });
  return data as SpeechScoreRow;
}

export async function listScoreEdits(
  debateId: string,
): Promise<{ score_id: string; before: Record<string, unknown>; after: Record<string, unknown>; created_at: string }[]> {
  const { data } = await admin()
    .from("team_score_edits")
    .select("score_id, before, after, created_at, team_speech_scores!inner(debate_id)")
    .eq("team_speech_scores.debate_id", debateId)
    .order("created_at");
  return ((data ?? []) as unknown as {
    score_id: string; before: Record<string, unknown>; after: Record<string, unknown>; created_at: string;
  }[]).map(({ score_id, before, after, created_at }) => ({ score_id, before, after, created_at }));
}

export async function listPenalties(debateId: string): Promise<{ side: Side; phase: TeamPhase; points: number; reason: string }[]> {
  const { data } = await admin()
    .from("team_penalties")
    .select("side, phase, points, reason")
    .eq("debate_id", debateId)
    .order("created_at");
  return (data ?? []) as { side: Side; phase: TeamPhase; points: number; reason: string }[];
}

// ── 결과 ────────────────────────────────────────────────────────────────────

export interface TeamReportRow {
  id: string;
  debate_id: string;
  status: "pending" | "done" | "failed" | "skipped";
  pro_total: number | null;
  con_total: number | null;
  stage_totals: Record<string, Record<Side, number>> | null;
  winner: Side | "draw" | null;
  feedback: TeamFeedback | null;
  member_notes: Record<string, string> | null;
  pending_count: number;
  model: string | null;
  attempts: number;
  error: string | null;
}

export interface TeamFeedback {
  best: Record<Side, { point: string; why: string }>;
  missed: string[];
  suggestions: string[];
}

const REPORT_COLS =
  "id, debate_id, status, pro_total, con_total, stage_totals, winner, feedback, member_notes, pending_count, model, attempts, error";

/** 결과 생성 착수권 (V-R42). unique(debate_id) 로 한 번만 성공한다. */
export async function claimTeamReport(debateId: string): Promise<boolean> {
  const { error } = await admin().from("team_reports").insert({ debate_id: debateId, status: "pending", attempts: 1 });
  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  throw new Error(`결과 생성 착수 실패: ${error.message}`);
}

/** 교사의 "다시 만들기". failed 인 것만 */
export async function reclaimTeamReport(debateId: string): Promise<boolean> {
  const { data: cur } = await admin().from("team_reports").select("attempts").eq("debate_id", debateId).maybeSingle();
  if (!cur) return false;
  const { data } = await admin()
    .from("team_reports")
    .update({ status: "pending", error: null, attempts: (cur as { attempts: number }).attempts + 1, updated_at: new Date().toISOString() })
    .eq("debate_id", debateId)
    .eq("status", "failed")
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

export async function getTeamReport(debateId: string): Promise<TeamReportRow | null> {
  const { data } = await admin().from("team_reports").select(REPORT_COLS).eq("debate_id", debateId).maybeSingle();
  return (data as TeamReportRow) ?? null;
}

export async function saveTeamReport(
  debateId: string,
  patch: Partial<Omit<TeamReportRow, "id" | "debate_id" | "attempts">>,
): Promise<void> {
  const { error } = await admin()
    .from("team_reports")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("debate_id", debateId);
  if (error) throw new Error(`결과 저장 실패: ${error.message}`);
}

// ── 학생 삭제 판단 (V-R5) ────────────────────────────────────────────────────

/** 이 학생이 팀 토론에 발언·팀 채팅을 남겼는가 */
export async function studentHasTeamRecords(studentId: string): Promise<boolean> {
  const { data: members } = await admin().from("team_members").select("id").eq("student_id", studentId);
  const ids = ((members ?? []) as { id: string }[]).map((m) => m.id);
  if (ids.length === 0) return false;
  const { count } = await admin()
    .from("team_messages")
    .select("id", { count: "exact", head: true })
    .in("member_id", ids);
  return (count ?? 0) > 0;
}

/** 학급 삭제 미리보기용: 팀 토론 수와 발언·채팅 수 */
export async function classTeamImpact(classId: string): Promise<{ teamDebateCount: number; teamMessageCount: number }> {
  const { data } = await admin().from("team_debates").select("id").eq("class_id", classId);
  const ids = ((data ?? []) as { id: string }[]).map((d) => d.id);
  if (ids.length === 0) return { teamDebateCount: 0, teamMessageCount: 0 };
  const { count } = await admin()
    .from("team_messages")
    .select("id", { count: "exact", head: true })
    .in("debate_id", ids)
    .in("kind", ["speech", "chat", "draft"]);
  return { teamDebateCount: ids.length, teamMessageCount: count ?? 0 };
}
