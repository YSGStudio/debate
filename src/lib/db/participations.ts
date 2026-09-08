import "server-only";
import { admin } from "@/lib/supabase/admin";
import { UNIQUE_VIOLATION, type MessageRow, type ParticipationRow, type Stance } from "./types";

const COLS = "id, session_id, student_id, stance, student_message_count, last_activity_at";

export async function getParticipation(
  sessionId: string,
  studentId: string,
): Promise<ParticipationRow | null> {
  const { data } = await admin()
    .from("participations")
    .select(COLS)
    .eq("session_id", sessionId)
    .eq("student_id", studentId)
    .maybeSingle();
  return (data as ParticipationRow) ?? null;
}

export async function getParticipationById(id: string): Promise<ParticipationRow | null> {
  const { data } = await admin().from("participations").select(COLS).eq("id", id).maybeSingle();
  return (data as ParticipationRow) ?? null;
}

/** 이미 참여 중이면 기존 참여를 그대로 돌려준다. 입장은 바꾸지 않는다 (R15, R16) */
export async function joinSession(
  sessionId: string,
  studentId: string,
  stance: Stance,
): Promise<ParticipationRow> {
  const existing = await getParticipation(sessionId, studentId);
  if (existing) return existing;

  const { data, error } = await admin()
    .from("participations")
    .insert({ session_id: sessionId, student_id: studentId, stance })
    .select(COLS)
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const again = await getParticipation(sessionId, studentId);
      if (again) return again;
    }
    throw new Error(`토론 참여 실패: ${error.message}`);
  }
  return data as ParticipationRow;
}

export async function listParticipations(sessionId: string): Promise<ParticipationRow[]> {
  const { data } = await admin().from("participations").select(COLS).eq("session_id", sessionId);
  return (data ?? []) as ParticipationRow[];
}

export async function listMessages(participationId: string): Promise<MessageRow[]> {
  const { data } = await admin()
    .from("messages")
    .select("id, participation_id, seq, role, content, created_at")
    .eq("participation_id", participationId)
    .order("seq");
  return (data ?? []) as MessageRow[];
}

export async function nextSeq(participationId: string): Promise<number> {
  const { data } = await admin()
    .from("messages")
    .select("seq")
    .eq("participation_id", participationId)
    .order("seq", { ascending: false })
    .limit(1);
  const rows = (data ?? []) as { seq: number }[];
  return (rows[0]?.seq ?? 0) + 1;
}

export async function appendMessage(
  participationId: string,
  seq: number,
  role: "student" | "bot",
  content: string,
): Promise<MessageRow> {
  const { data, error } = await admin()
    .from("messages")
    .insert({ participation_id: participationId, seq, role, content })
    .select("id, participation_id, seq, role, content, created_at")
    .single();
  if (error) throw new Error(`메시지 저장 실패: ${error.message}`);
  return data as MessageRow;
}

export async function bumpStudentMessageCount(
  participationId: string,
  newCount: number,
): Promise<void> {
  await admin()
    .from("participations")
    .update({ student_message_count: newCount, last_activity_at: new Date().toISOString() })
    .eq("id", participationId);
}
