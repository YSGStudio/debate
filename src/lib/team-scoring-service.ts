import "server-only";
import {
  claimSpeechScore,
  claimTeamReport,
  failSpeechScore,
  getTeamDebate,
  getTeamMessage,
  getTeamReport,
  insertInappropriateAlert,
  listFloorMessages,
  listPenalties,
  listScoreEdits,
  listSpeechScores,
  listTeamMembers,
  reclaimSpeechScore,
  reclaimTeamReport,
  saveSpeechScore,
  saveTeamReport,
  type SpeechScoreRow,
  type TeamDebateRow,
  type TeamFeedback,
  type TeamMemberView,
  type TeamMessageRow,
  type TeamReportRow,
} from "@/lib/db/team-debates";
import { judgeSpeech, generateTeamFeedback } from "@/lib/ai/team-judge";
import { checkModeration } from "@/lib/ai/triage";
import type { JudgeLine, JudgeSpeechInput } from "@/lib/prompts/team-judge";
import type { TeamReportInput } from "@/lib/prompts/team-report";
import {
  computeTeamTotals,
  decideWinner,
  isFloorPhase,
  type Side,
  type TeamPhase,
  type TeamTotals,
} from "@/lib/team/rules";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ══════════════════════════════════════════════════════════════════════════
// 발언 채점 (V-R30~V-R37)
// ══════════════════════════════════════════════════════════════════════════

export interface JudgeDeps {
  judge?: typeof judgeSpeech;
  sleep?: (ms: number) => Promise<void>;
  /** 첫 실패 뒤 다시 시도하기까지 (V-R35: 5초) */
  retryDelayMs?: number;
}

function teamNames(d: TeamDebateRow): Record<Side, string> {
  return { pro: d.pro_name, con: d.con_name };
}

function toLine(m: TeamMessageRow, members: Map<string, TeamMemberView>): JudgeLine {
  const mem = m.member_id ? members.get(m.member_id) : undefined;
  return {
    seq: m.seq,
    phase: m.phase,
    side: (m.side ?? mem?.side ?? "pro") as Side,
    // AI 에는 가명만 (V-R32)
    alias: mem?.alias ?? `${m.side === "con" ? "반대" : "찬성"}팀 학생`,
    content: m.content,
  };
}

/** 채점 입력을 만든다. 숨긴 발언과 이후 발언은 넣지 않는다 (V-R31). */
export async function buildJudgeInput(msg: TeamMessageRow): Promise<JudgeSpeechInput | null> {
  const debate = await getTeamDebate(msg.debate_id);
  if (!debate) return null;
  const [members, floor] = await Promise.all([listTeamMembers(debate.id), listFloorMessages(debate.id)]);
  const byId = new Map(members.map((m) => [m.id, m]));
  const history = floor
    .filter((m) => m.kind === "speech" && !m.hidden_at && m.seq < msg.seq)
    .map((m) => toLine(m, byId));
  return {
    topic: debate.topic,
    description: debate.description,
    grade: debate.grade_level,
    teamNames: teamNames(debate),
    speech: toLine(msg, byId),
    history,
  };
}

/**
 * 발언 하나 채점. 발언 저장 직후 `runInBackground` 로 부른다.
 *
 * 착수권은 DB unique 로 가져온다 — 같은 발언에 두 번 불려도 모델 호출은 한 번 (V-R37).
 * 첫 시도가 실패하면 5초 뒤 한 번 더 (V-R35). 그래도 실패면 failed ("채점 대기").
 * `retryScoreId` 가 있으면 교사의 "다시 채점" 이다 — 교사가 고친 점수는 다시 잡지 않는다.
 */
export async function runSpeechJudging(
  messageId: string,
  opts: JudgeDeps & { retryScoreId?: string } = {},
): Promise<"done" | "failed" | "already" | "skipped"> {
  const judge = opts.judge ?? judgeSpeech;
  const wait = opts.sleep ?? sleep;

  const msg = await getTeamMessage(messageId);
  if (!msg || msg.kind !== "speech") return "skipped";

  if (opts.retryScoreId) {
    const reclaimed = await reclaimSpeechScore(opts.retryScoreId);
    if (!reclaimed) return "already";
  } else if (!(await claimSpeechScore(messageId, msg.debate_id))) {
    return "already";
  }

  try {
    const input = await buildJudgeInput(msg);
    if (!input) throw new Error("토론을 찾을 수 없습니다.");

    let r = await judge(input);
    if (r.failed && !opts.retryScoreId) {
      await wait(opts.retryDelayMs ?? 5000);
      r = await judge(input);
    }
    if (r.failed) {
      await failSpeechScore(messageId, r.error);
      return "failed";
    }

    await saveSpeechScore(messageId, {
      ...r.parts,
      total: r.total,
      reason: r.reason,
      respondedToSeq: r.respondedToSeq,
      model: r.model,
    });
    await refreshReportTotals(msg.debate_id);
    return "done";
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[team-scoring] 발언 채점 실패:", messageId, error);
    await failSpeechScore(messageId, error);
    return "failed";
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 부적절 판정 (V-R46). 알림만 남긴다. 자동으로 숨기지 않는다.
// ══════════════════════════════════════════════════════════════════════════

export async function moderateTeamMessage(
  input: { debateId: string; messageId: string; content: string },
  check: typeof checkModeration = checkModeration,
): Promise<void> {
  try {
    const r = await check(input.content);
    if (!r.flagged) return;
    // 알림에 학생 이름과 팀이 보이도록 작성자를 붙인다
    const msg = await getTeamMessage(input.messageId);
    await insertInappropriateAlert({
      debateId: input.debateId,
      messageId: input.messageId,
      memberId: msg?.member_id ?? null,
      side: msg?.side ?? null,
      detail: r.reason ?? "부적절한 표현",
    });
  } catch (e) {
    // 판정 실패는 조용히 넘어간다. 전송은 이미 끝났다.
    console.error("[team-moderation] 판정 실패:", e instanceof Error ? e.message : e);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 합산 (V-R39, V-R40). 서버가 한다.
// ══════════════════════════════════════════════════════════════════════════

export interface DebateTotalsData {
  debate: TeamDebateRow;
  members: TeamMemberView[];
  floor: TeamMessageRow[];
  scores: Map<string, SpeechScoreRow>;
  penalties: { side: Side; phase: TeamPhase; points: number; reason: string }[];
  totals: TeamTotals;
  winner: Side | "draw";
}

export async function loadDebateTotals(debateId: string): Promise<DebateTotalsData | null> {
  const debate = await getTeamDebate(debateId);
  if (!debate) return null;
  const [members, floor, scoreRows, penalties] = await Promise.all([
    listTeamMembers(debateId),
    listFloorMessages(debateId),
    listSpeechScores(debateId),
    listPenalties(debateId),
  ]);
  const scores = new Map(scoreRows.map((s) => [s.message_id, s]));
  const totals = computeTeamTotals(
    floor
      .filter((m) => m.kind === "speech" && m.side)
      .map((m) => {
        const sc = scores.get(m.id);
        return {
          side: m.side as Side,
          phase: m.phase,
          hidden: m.hidden_at !== null,
          status: sc?.status ?? null,
          total: sc?.total ?? null,
        };
      }),
    penalties,
  );
  return { debate, members, floor, scores, penalties, totals, winner: decideWinner(totals) };
}

/** 교사가 점수를 고치거나 발언을 숨기면 결과의 총점·우승을 즉시 다시 계산한다. 피드백은 그대로 (V-R42). */
export async function refreshReportTotals(debateId: string): Promise<void> {
  const report = await getTeamReport(debateId);
  if (!report || report.status === "pending") return;
  const data = await loadDebateTotals(debateId);
  if (!data) return;
  await saveTeamReport(debateId, {
    pro_total: data.totals.pro,
    con_total: data.totals.con,
    stage_totals: data.totals.byStage as Record<string, Record<Side, number>>,
    winner: data.totals.speechCount === 0 ? null : data.winner,
    pending_count: data.totals.pendingCount + data.totals.failedCount,
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 종료 후 결과 (V-R38~V-R42)
// ══════════════════════════════════════════════════════════════════════════

export interface ReportDeps {
  feedback?: typeof generateTeamFeedback;
  sleep?: (ms: number) => Promise<void>;
  /** 채점 중 발언을 기다리는 최대 시간 (V-R38: 60초) */
  waitMs?: number;
  pollMs?: number;
}

/**
 * 토론당 1회 (DB unique). 종료 API 는 이것을 기다리지 않는다.
 * `retry` 는 교사의 "다시 만들기" — failed 인 것만 다시 잡는다.
 */
export async function buildTeamReport(
  debateId: string,
  opts: ReportDeps & { retry?: boolean } = {},
): Promise<"done" | "failed" | "skipped" | "already"> {
  const claimed = opts.retry ? await reclaimTeamReport(debateId) : await claimTeamReport(debateId);
  if (!claimed) return "already";

  const wait = opts.sleep ?? sleep;
  const waitMs = opts.waitMs ?? 60000;
  const pollMs = opts.pollMs ?? 2000;

  try {
    // 채점 중인 발언을 최대 60초 기다린다. 넘으면 있는 점수로 진행하고 대기 건수를 남긴다.
    let data = await loadDebateTotals(debateId);
    for (let waited = 0; data && data.totals.pendingCount > 0 && waited < waitMs; waited += pollMs) {
      await wait(pollMs);
      data = await loadDebateTotals(debateId);
    }
    if (!data) throw new Error("토론을 찾을 수 없습니다.");

    const { debate, totals, winner, members, floor, scores } = data;
    const base = {
      pro_total: totals.pro,
      con_total: totals.con,
      stage_totals: totals.byStage as Record<string, Record<Side, number>>,
      pending_count: totals.pendingCount + totals.failedCount,
    };

    // 발언이 하나도 없으면 결과를 만들지 않는다 (V-R40)
    if (totals.speechCount === 0) {
      await saveTeamReport(debateId, { ...base, status: "skipped", winner: null });
      return "skipped";
    }

    await saveTeamReport(debateId, { ...base, winner });

    const byId = new Map(members.map((m) => [m.id, m]));
    const input: TeamReportInput = {
      topic: debate.topic,
      description: debate.description,
      grade: debate.grade_level,
      teamNames: teamNames(debate),
      totals,
      winner,
      transcript: floor
        .filter((m) => m.kind === "speech" && !m.hidden_at)
        .map((m) => ({ ...toLine(m, byId), total: scores.get(m.id)?.total ?? null })),
      members: members.map((m) => ({ alias: m.alias, side: m.side, speechCount: m.speech_count })),
    };

    const result = await (opts.feedback ?? generateTeamFeedback)(input);
    const aliasToId = new Map(members.map((m) => [m.alias, m.id]));
    const memberNotes = Object.fromEntries(
      Object.entries(result.notesByAlias)
        .filter(([alias]) => aliasToId.has(alias))
        .map(([alias, note]) => [aliasToId.get(alias) as string, note]),
    );

    await saveTeamReport(debateId, {
      status: "done",
      feedback: result.feedback as TeamFeedback,
      member_notes: memberNotes,
      model: result.model,
      error: null,
    });
    return "done";
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[team-report] 결과 생성 실패:", debateId, error);
    await saveTeamReport(debateId, { status: "failed", error }).catch(() => {});
    return "failed";
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 조회 (보고서 화면, PDF, 학생 결과)
// ══════════════════════════════════════════════════════════════════════════

export interface TeacherReport {
  debate: TeamDebateRow;
  totals: TeamTotals;
  winner: Side | "draw" | null;
  report: TeamReportRow | null;
  members: { id: string; name: string; side: Side; speechCount: number; note: string | null }[];
  floor: {
    id: string; seq: number; phase: TeamPhase; kind: string; side: Side | null; author: string | null;
    content: string; hidden: boolean;
    score: {
      id: string; status: string; total: number | null; logic: number | null; evidence: number | null;
      response: number | null; phaseFit: number | null; attitude: number | null; reason: string | null;
      respondedToSeq: number | null; edited: boolean;
    } | null;
  }[];
  penalties: { side: Side; phase: TeamPhase; points: number; reason: string }[];
  edits: { scoreId: string; before: Record<string, unknown>; after: Record<string, unknown>; at: string }[];
}

export async function getTeacherReport(debateId: string): Promise<TeacherReport | null> {
  const data = await loadDebateTotals(debateId);
  if (!data) return null;
  const [report, edits] = await Promise.all([getTeamReport(debateId), listScoreEdits(debateId)]);
  const byId = new Map(data.members.map((m) => [m.id, m]));
  const notes = report?.member_notes ?? {};

  return {
    debate: data.debate,
    totals: data.totals,
    winner: data.totals.speechCount === 0 ? null : data.winner,
    report,
    members: data.members.map((m) => ({
      id: m.id, name: m.display_name, side: m.side, speechCount: m.speech_count, note: notes[m.id] ?? null,
    })),
    floor: data.floor.map((m) => {
      const sc = data.scores.get(m.id);
      return {
        id: m.id, seq: m.seq, phase: m.phase, kind: m.kind, side: m.side,
        author: m.member_id ? (byId.get(m.member_id)?.display_name ?? null) : null,
        content: m.content, hidden: m.hidden_at !== null,
        score: sc
          ? {
              id: sc.id, status: sc.status, total: sc.total, logic: sc.logic, evidence: sc.evidence,
              response: sc.response, phaseFit: sc.phase_fit, attitude: sc.attitude, reason: sc.reason,
              respondedToSeq: sc.responded_to_seq, edited: sc.edited_at !== null,
            }
          : null,
      };
    }),
    penalties: data.penalties,
    edits: edits.map((e) => ({ scoreId: e.score_id, before: e.before, after: e.after, at: e.created_at })),
  };
}

/** 학생 결과 응답의 키. 이 밖의 것을 담지 않는다 (V-R43, R53). */
export const STUDENT_RESULT_KEYS = ["topic", "teams", "winner", "stageScores", "feedback", "pendingCount"] as const;

export type StudentResult =
  | { status: "preparing"; topic: string }
  | {
      topic: string;
      teams: Record<Side, { name: string; total: number }>;
      winner: Side | "draw" | null;
      stageScores: Partial<Record<TeamPhase, Record<Side, number>>>;
      feedback: { best: Record<Side, { point: string; why: string }>; missed: string[]; suggestions: string[] } | null;
      pendingCount: number;
    };

/**
 * 학생 결과 (V-R43). 결과 공개 전이면 준비 중.
 * 학생 이름·발언 수·개인 잘한 점·개인 점수를 담지 않는다.
 */
export async function getStudentResult(debateId: string): Promise<StudentResult | null> {
  const data = await loadDebateTotals(debateId);
  if (!data) return null;
  const { debate, totals } = data;
  if (!debate.results_published_at) return { status: "preparing", topic: debate.topic };

  const report = await getTeamReport(debateId);
  const stageScores = Object.fromEntries(
    Object.entries(totals.byStage).filter(([ph]) => isFloorPhase(ph as TeamPhase)),
  ) as Partial<Record<TeamPhase, Record<Side, number>>>;
  const fb = report?.status === "done" ? report.feedback : null;

  return {
    topic: debate.topic,
    teams: {
      pro: { name: debate.pro_name, total: totals.pro },
      con: { name: debate.con_name, total: totals.con },
    },
    winner: totals.speechCount === 0 ? null : data.winner,
    stageScores,
    feedback: fb ? { best: fb.best, missed: fb.missed, suggestions: fb.suggestions } : null,
    pendingCount: totals.pendingCount + totals.failedCount,
  };
}
