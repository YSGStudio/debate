import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedTeamDebate, setSpeechHidden } from "@/lib/db/team-debates";
import { refreshReportTotals } from "@/lib/team-scoring-service";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";

/** 발언 숨김/되돌리기 (ver2 V-R17). 숨긴 발언 점수는 팀 총점에서 빠진다. */
export async function PATCH(req: Request, ctx: { params: Promise<{ debateId: string; messageId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId, messageId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();

  const parsed = z.object({ hidden: z.boolean() }).safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError("입력을 확인해 주세요.", 400);

  if (!(await setSpeechHidden(debateId, messageId, parsed.data.hidden))) return notFound();
  await refreshReportTotals(debateId);
  return NextResponse.json({ hidden: parsed.data.hidden });
}
