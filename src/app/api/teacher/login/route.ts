import { NextResponse } from "next/server";
import { z } from "zod";
import { anon } from "@/lib/supabase/admin";
import { getTeacher } from "@/lib/db/teachers";
import { setTeacherSession } from "@/lib/session/teacher";
import { jsonError, readJson } from "@/lib/api";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

/** 교사 로그인 (R3). 비밀번호 검증은 Supabase Auth 가 한다. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError("이메일과 비밀번호를 확인해 주세요.", 400);

  const { data, error } = await anon().auth.signInWithPassword(parsed.data);
  if (error || !data.user) return jsonError("이메일 또는 비밀번호가 올바르지 않습니다.", 401);

  const teacher = await getTeacher(data.user.id);
  if (!teacher) return jsonError("교사 정보를 찾을 수 없습니다.", 401);

  await setTeacherSession(data.user.id);
  return NextResponse.json({ ok: true });
}
