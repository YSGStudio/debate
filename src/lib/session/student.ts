import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { signToken, verifyToken } from "./token";

export const STUDENT_COOKIE = "ss_token";
const TTL = "12h";

export interface StudentSession {
  classId: string;
  studentId: string;
}

/** 학생 입장 시 서명 쿠키 발급 (PRD R14) */
export async function setStudentSession(s: StudentSession): Promise<void> {
  const token = await signToken(env.studentSessionSecret, { ...s }, TTL);
  const jar = await cookies();
  jar.set(STUDENT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
}

export async function getStudentSession(): Promise<StudentSession | null> {
  const jar = await cookies();
  const token = jar.get(STUDENT_COOKIE)?.value;
  if (!token) return null;
  const p = await verifyToken<{ classId: string; studentId: string }>(env.studentSessionSecret, token);
  if (!p?.classId || !p?.studentId) return null;
  return { classId: p.classId, studentId: p.studentId };
}

export async function clearStudentSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(STUDENT_COOKIE);
}
