import "server-only";
import { NextResponse } from "next/server";
import { getTeacherSession } from "@/lib/session/teacher";

export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** 교사 인증 게이트. 미인증이면 401 (R3) */
export async function requireTeacher(): Promise<
  { teacherId: string } | { response: NextResponse }
> {
  const s = await getTeacherSession();
  if (!s) return { response: jsonError("로그인이 필요합니다.", 401) };
  return { teacherId: s.teacherId };
}

export function isErr(v: unknown): v is { response: NextResponse } {
  return typeof v === "object" && v !== null && "response" in v;
}

/** 남의 리소스는 없는 것처럼 다룬다 (R4) */
export function notFound() {
  return jsonError("찾을 수 없습니다.", 404);
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
