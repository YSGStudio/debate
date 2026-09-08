import { NextResponse } from "next/server";
import { rotateJoinCode } from "@/lib/db/classes";
import { isErr, notFound, requireTeacher } from "@/lib/api";

/** 학급 코드 재발급 (R8) */
export async function POST(_req: Request, ctx: { params: Promise<{ classId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { classId } = await ctx.params;

  const updated = await rotateJoinCode(auth.teacherId, classId);
  if (!updated) return notFound();
  return NextResponse.json({ class: updated });
}
