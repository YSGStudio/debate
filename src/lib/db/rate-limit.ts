import "server-only";
import { admin } from "@/lib/supabase/admin";

/** 학생 1명당 메시지 전송 최소 간격 (R38) */
export const MIN_INTERVAL_MS = 5000;

/**
 * 통과하면 true, 너무 빠르면 false.
 * 마지막 전송 시각을 조건에 넣어 갱신하므로 동시 요청에서도 하나만 통과한다.
 */
export async function takeMessageSlot(participationId: string, now = Date.now()): Promise<boolean> {
  const key = `msg:${participationId}`;
  const nowIso = new Date(now).toISOString();

  const { data: existing } = await admin()
    .from("rate_limits")
    .select("key, last_at")
    .eq("key", key)
    .maybeSingle();

  if (!existing) {
    const { error } = await admin().from("rate_limits").insert({ key, last_at: nowIso });
    return !error; // 동시 삽입 경쟁에서 진 쪽은 거부된다
  }

  const last = new Date((existing as { last_at: string }).last_at).getTime();
  if (now - last < MIN_INTERVAL_MS) return false;

  const { data } = await admin()
    .from("rate_limits")
    .update({ last_at: nowIso })
    .eq("key", key)
    .eq("last_at", (existing as { last_at: string }).last_at)
    .select("key");
  return Array.isArray(data) && data.length > 0;
}
