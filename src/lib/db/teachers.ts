import "server-only";
import { admin } from "@/lib/supabase/admin";

export interface InviteCodeRow {
  code: string;
  max_uses: number;
  used_count: number;
  is_active: boolean;
}

/** 초대 코드가 지금 쓸 수 있는 상태인지 (R1) */
export async function findUsableInviteCode(code: string): Promise<InviteCodeRow | null> {
  const { data } = await admin()
    .from("invite_codes")
    .select("code, max_uses, used_count, is_active")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();
  if (!data) return null;
  const row = data as InviteCodeRow;
  if (!row.is_active) return null;
  if (row.used_count >= row.max_uses) return null;
  return row;
}

/**
 * 사용 횟수를 1 올린다 (R2). used_count 를 조건에 넣어 동시 가입 경쟁에서도
 * max_uses 를 넘지 않게 한다. 갱신된 행이 없으면 false.
 */
export async function consumeInviteCode(code: string, seenUsedCount: number): Promise<boolean> {
  const { data } = await admin()
    .from("invite_codes")
    .update({ used_count: seenUsedCount + 1 })
    .eq("code", code)
    .eq("used_count", seenUsedCount)
    .select("code");
  return Array.isArray(data) && data.length > 0;
}

export async function createTeacherProfile(id: string, email: string, name: string): Promise<void> {
  const { error } = await admin().from("teachers").insert({ id, email, name });
  if (error) throw new Error(`교사 프로필 생성 실패: ${error.message}`);
}

export async function getTeacher(id: string) {
  const { data } = await admin()
    .from("teachers")
    .select("id, email, name")
    .eq("id", id)
    .maybeSingle();
  return data as { id: string; email: string; name: string } | null;
}
