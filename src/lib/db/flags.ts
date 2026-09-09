import "server-only";
import { admin } from "@/lib/supabase/admin";
import type { CoachKind, FlagRow, TriageVerdict } from "./types";

export interface SaveFlagInput {
  messageId: string;
  participationId: string;
  verdict: TriageVerdict;
  reason: string | null;
  triageFailed: boolean;
  coachKind: CoachKind;
  coachMessage: string | null;
}

export async function saveFlag(input: SaveFlagInput): Promise<void> {
  const { error } = await admin().from("moderation_flags").insert({
    message_id: input.messageId,
    participation_id: input.participationId,
    verdict: input.verdict,
    reason: input.reason,
    triage_failed: input.triageFailed,
    coach_kind: input.coachKind,
    coach_message: input.coachMessage,
  });
  if (error) console.error("[flags] 판정 저장 실패:", error.message);
}

export async function listFlags(participationId: string): Promise<FlagRow[]> {
  const { data } = await admin()
    .from("moderation_flags")
    .select(
      "id, message_id, participation_id, verdict, reason, triage_failed, acknowledged_at, coach_kind, coach_message, created_at",
    )
    .eq("participation_id", participationId);
  return (data ?? []) as FlagRow[];
}

/** 경고 확인 처리 (R32). 소유권은 호출부에서 세션으로 확인한다. */
export async function acknowledgeFlag(flagId: string, sessionId: string): Promise<boolean> {
  const { data } = await admin()
    .from("moderation_flags")
    .select("id, participations!inner(session_id)")
    .eq("id", flagId)
    .maybeSingle();
  if (!data) return false;
  const row = data as unknown as { participations: { session_id: string } };
  if (row.participations.session_id !== sessionId) return false;

  const { error } = await admin()
    .from("moderation_flags")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", flagId);
  return !error;
}
