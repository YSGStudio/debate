import { NextResponse } from "next/server";
import { z } from "zod";
import { admin, anon } from "@/lib/supabase/admin";
import { consumeInviteCode, createTeacherProfile, findUsableInviteCode } from "@/lib/db/teachers";
import { setTeacherSession } from "@/lib/session/teacher";
import { jsonError, readJson } from "@/lib/api";

const Body = z.object({
  email: z.string().email("이메일 형식이 올바르지 않습니다."),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다."),
  name: z.string().min(1, "이름을 입력해 주세요.").max(30),
  inviteCode: z.string().min(1, "초대 코드를 입력해 주세요."),
});

/** 교사 가입 (R1, R2). 초대 코드가 유효할 때만 계정이 만들어진다. */
export async function POST(req: Request) {
  const body = await readJson<unknown>(req);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "입력을 확인해 주세요.", 400);
  }
  const { email, password, name, inviteCode } = parsed.data;

  const invite = await findUsableInviteCode(inviteCode);
  if (!invite) return jsonError("초대 코드가 올바르지 않습니다.", 403);

  // 코드를 먼저 소진시킨다. 계정 생성이 실패하면 되돌린다.
  const consumed = await consumeInviteCode(invite.code, invite.used_count);
  if (!consumed) return jsonError("초대 코드가 올바르지 않습니다.", 403);

  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    await admin()
      .from("invite_codes")
      .update({ used_count: invite.used_count })
      .eq("code", invite.code);
    const msg = error?.message ?? "";
    if (/already|registered|exists/i.test(msg)) {
      return jsonError("이미 가입된 이메일입니다.", 409);
    }
    return jsonError("계정을 만들지 못했습니다. 다시 시도해 주세요.", 500);
  }

  try {
    await createTeacherProfile(data.user.id, email, name);
  } catch {
    await admin().auth.admin.deleteUser(data.user.id);
    await admin().from("invite_codes").update({ used_count: invite.used_count }).eq("code", invite.code);
    return jsonError("계정을 만들지 못했습니다. 다시 시도해 주세요.", 500);
  }

  // 비밀번호는 Supabase Auth 가 보관·검증한다.
  await anon().auth.signInWithPassword({ email, password });
  await setTeacherSession(data.user.id);
  return NextResponse.json({ ok: true });
}
