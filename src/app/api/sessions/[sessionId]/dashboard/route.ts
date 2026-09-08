import { NextResponse } from "next/server";
import { dashboardSnapshot } from "@/lib/db/dashboard";
import { isErr, notFound, requireTeacher } from "@/lib/api";

/** 대시보드 폴링 (R28, R29, R30, R33, R54, R55). DB 왕복 1회. */
export async function GET(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { sessionId } = await ctx.params;

  const snap = await dashboardSnapshot(sessionId);
  if (!snap?.session) return notFound();
  if (snap.session.teacher_id !== auth.teacherId) return notFound(); // R4

  return NextResponse.json(snap, {
    headers: { "cache-control": "no-store" },
  });
}
