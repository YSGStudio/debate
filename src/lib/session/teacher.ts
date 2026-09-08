import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { signToken, verifyToken } from "./token";

export const TEACHER_COOKIE = "ts_token";
const TTL = "7d";

export interface TeacherSession {
  teacherId: string;
}

/**
 * 비밀번호 검증은 Supabase Auth 가 한다(PRD 기술 결정). 검증에 성공한 뒤
 * 요청마다 Supabase 를 왕복하지 않도록 우리 서명 쿠키를 발급한다.
 */
export async function setTeacherSession(teacherId: string): Promise<void> {
  const token = await signToken(env.teacherSessionSecret, { teacherId }, TTL);
  const jar = await cookies();
  jar.set(TEACHER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function getTeacherSession(): Promise<TeacherSession | null> {
  const jar = await cookies();
  const token = jar.get(TEACHER_COOKIE)?.value;
  if (!token) return null;
  const p = await verifyToken<{ teacherId: string }>(env.teacherSessionSecret, token);
  return p?.teacherId ? { teacherId: p.teacherId } : null;
}

export async function clearTeacherSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(TEACHER_COOKIE);
}
