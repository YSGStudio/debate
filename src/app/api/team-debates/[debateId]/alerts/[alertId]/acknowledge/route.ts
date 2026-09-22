import { NextResponse } from "next/server";
import { acknowledgeTeamAlert, getOwnedTeamDebate } from "@/lib/db/team-debates";
import { isErr, notFound, requireTeacher } from "@/lib/api";

/** 관제실 알림 확인 처리 */
export async function POST(_req: Request, ctx: { params: Promise<{ debateId: string; alertId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId, alertId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();
  if (!(await acknowledgeTeamAlert(debateId, alertId))) return notFound();
  return NextResponse.json({ acknowledged: true });
}
