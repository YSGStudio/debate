import { NextResponse } from "next/server";
import { getOwnedTeamDebate, getTeamReport } from "@/lib/db/team-debates";
import { runInBackground } from "@/lib/background";
import { buildTeamReport } from "@/lib/team-scoring-service";
import { isErr, jsonError, notFound, requireTeacher } from "@/lib/api";

export const maxDuration = 300;

/** 결과 다시 만들기 (ver2 V-R42). 실패한 결과만. 뒤에서 돈다. */
export async function POST(_req: Request, ctx: { params: Promise<{ debateId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();
  if (owned.debate.status !== "closed") return jsonError("끝난 토론만 결과를 만들 수 있어요.", 409);

  const report = await getTeamReport(debateId);
  if (!report) {
    // 종료 직후 결과 생성이 아예 시작되지 못한 경우
    runInBackground(buildTeamReport(debateId), "team/결과 생성");
    return NextResponse.json({ started: true });
  }
  if (report.status !== "failed") return jsonError("실패한 결과만 다시 만들 수 있어요.", 409);
  runInBackground(buildTeamReport(debateId, { retry: true }), "team/결과 다시 만들기");
  return NextResponse.json({ started: true });
}
