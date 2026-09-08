import "server-only";
import { admin } from "@/lib/supabase/admin";
import type { FlagRow, TriageVerdict } from "./types";

export async function saveFlag(
  messageId: string,
  participationId: string,
  verdict: TriageVerdict,
  reason: string | null,
  triageFailed: boolean,
): Promise<void> {
  const { error } = await admin().from("moderation_flags").insert({
    message_id: messageId,
    participation_id: participationId,
    verdict,
    reason,
    triage_failed: triageFailed,
  });
  if (error) console.error("[flags] 판정 저장 실패:", error.message);
}

export async function listFlags(participationId: string): Promise<FlagRow[]> {
  const { data } = await admin()
    .from("moderation_flags")
    .select("id, message_id, participation_id, verdict, reason, triage_failed, acknowledged_at, created_at")
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
