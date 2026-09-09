import "server-only";
import { admin } from "@/lib/supabase/admin";
import type { SessionRow } from "./types";

const COLS =
  "id, class_id, topic, description, grade_level, status, message_limit, opened_at, closed_at, created_at";

export async function createSession(
  classId: string,
  gradeLevel: number,
  topic: string,
  description: string | null,
  messageLimit: number,
): Promise<SessionRow> {
  const { data, error } = await admin()
    .from("debate_sessions")
    .insert({
      class_id: classId,
      topic,
      description,
      grade_level: gradeLevel, // 생성 시 학급 학년을 스냅샷 (R41)
      message_limit: messageLimit,
      status: "draft",
    })
    .select(COLS)
    .single();
  if (error) throw new Error(`세션 생성 실패: ${error.message}`);
  return data as SessionRow;
}

export async function listSessions(classId: string): Promise<SessionRow[]> {
  const { data } = await admin()
    .from("debate_sessions")
    .select(COLS)
    .eq("class_id", classId)
    .order("created_at", { ascending: false });
  return (data ?? []) as SessionRow[];
}

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const { data } = await admin().from("debate_sessions").select(COLS).eq("id", sessionId).maybeSingle();
  return (data as SessionRow) ?? null;
}

/** 소유권 검사를 겸한 조회. 남의 세션이면 null (R4) */
export async function getOwnedSession(
  teacherId: string,
  sessionId: string,
): Promise<{ session: SessionRow; className: string; classId: string } | null> {
  const { data } = await admin()
    .from("debate_sessions")
    .select(`${COLS}, classes!inner(id, name, teacher_id, single_active_session)`)
    .eq("id", sessionId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as SessionRow & {
    classes: { id: string; name: string; teacher_id: string };
  };
  if (row.classes.teacher_id !== teacherId) return null;
  return { session: row as SessionRow, className: row.classes.name, classId: row.classes.id };
}

export async function listOpenSessions(classId: string): Promise<SessionRow[]> {
  const { data } = await admin()
    .from("debate_sessions")
    .select(COLS)
    .eq("class_id", classId)
    .eq("status", "open")
    .order("opened_at", { ascending: false });
  return (data ?? []) as SessionRow[];
}

export async function updateDraftSession(
  sessionId: string,
  patch: Partial<Pick<SessionRow, "topic" | "description" | "grade_level" | "message_limit">>,
): Promise<SessionRow | null> {
  const { data } = await admin()
    .from("debate_sessions")
    .update(patch)
    .eq("id", sessionId)
    .eq("status", "draft") // draft 에서만 수정 가능 (R41)
    .select(COLS)
    .maybeSingle();
  return (data as SessionRow) ?? null;
}

export type OpenResult = "opened" | "conflict" | "not_draft" | "not_found";

/**
 * draft -> open 전이 (R11).
 * "한 번에 하나만 열기" 검사와 상태 변경을 DB 함수 안에서 원자적으로 처리한다.
 * 응용 코드에서 조회-후-갱신으로 하면 동시 요청 둘이 모두 통과할 수 있다.
 */
export async function openSessionAtomic(
  sessionId: string,
): Promise<{ result: OpenResult; conflictTopic: string | null }> {
  const { data, error } = await admin().rpc("open_session_atomic", { p_session_id: sessionId });
  if (error) throw new Error(`토론 시작 실패: ${error.message}`);
  const rows = (data ?? []) as { result: OpenResult; conflict_topic: string | null }[];
  const row = rows[0];
  if (!row) return { result: "not_found", conflictTopic: null };
  return { result: row.result, conflictTopic: row.conflict_topic };
}

export interface SessionImpact {
  topic: string;
  status: SessionRow["status"];
  joinedStudents: number;
  messageCount: number;
  scoredCount: number;
}

/**
 * 토론을 지울 때 함께 사라지는 것을 센다.
 * 교사가 "삭제" 를 누르기 전에 무엇을 잃는지 정확히 알아야 한다.
 */
export async function sessionDeletionImpact(session: SessionRow): Promise<SessionImpact> {
  const { data: parts } = await admin()
    .from("participations")
    .select("id")
    .eq("session_id", session.id);
  const ids = ((parts ?? []) as { id: string }[]).map((p) => p.id);

  if (ids.length === 0) {
    return { topic: session.topic, status: session.status, joinedStudents: 0, messageCount: 0, scoredCount: 0 };
  }

  const [{ count: messageCount }, { count: scoredCount }] = await Promise.all([
    admin().from("messages").select("id", { count: "exact", head: true }).in("participation_id", ids),
    admin()
      .from("debate_scores")
      .select("id", { count: "exact", head: true })
      .in("participation_id", ids)
      .eq("status", "done"),
  ]);

  return {
    topic: session.topic,
    status: session.status,
    joinedStudents: ids.length,
    messageCount: messageCount ?? 0,
    scoredCount: scoredCount ?? 0,
  };
}

/**
 * 토론 삭제. FK 가 cascade 이므로 참여·메시지·판정·채점이 함께 사라진다.
 * 진행 중인 토론은 지우지 않는다 — 대화하던 학생 화면이 그대로 멈춰버린다.
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const { error } = await admin()
    .from("debate_sessions")
    .delete()
    .eq("id", sessionId)
    .neq("status", "open");
  return !error;
}

/** open -> closed. closed 에서 다시 열 수 없다 (R10) */
export async function closeSession(sessionId: string): Promise<SessionRow | null> {
  const { data } = await admin()
    .from("debate_sessions")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("status", "open")
    .select(COLS)
    .maybeSingle();
  return (data as SessionRow) ?? null;
}
