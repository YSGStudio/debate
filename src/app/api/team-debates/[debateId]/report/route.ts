import { NextResponse } from "next/server";
import { getOwnedTeamDebate } from "@/lib/db/team-debates";
import { getTeacherReport } from "@/lib/team-scoring-service";
import { isErr, notFound, requireTeacher } from "@/lib/api";

/** 교사 결과 보고서 (ver2 V-R44). 총점·우승은 매번 서버가 다시 계산한다. */
export async function GET(_req: Request, ctx: { params: Promise<{ debateId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();

  const report = await getTeacherReport(debateId);
  if (!report) return notFound();
  return NextResponse.json({ ...report, className: owned.className });
}
