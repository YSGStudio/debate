import { NextResponse } from "next/server";
import { z } from "zod";
import { editSpeechScore, getOwnedTeamDebate, getSpeechScore } from "@/lib/db/team-debates";
import { refreshReportTotals } from "@/lib/team-scoring-service";
import { partsInRange, speechTotal } from "@/lib/team/rules";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";

const Body = z.object({
  logic: z.number(),
  evidence: z.number(),
  response: z.number(),
  phaseFit: z.number(),
  attitude: z.number(),
});

/**
 * 교사 점수 수정 (ver2 V-R36). 범위 밖이면 400.
 * 발언 점수는 서버가 다시 합산하고, 수정 전·후 값이 이력으로 남는다.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ debateId: string; scoreId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId, scoreId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();

  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success || !partsInRange(parsed.data)) {
    return jsonError("점수 범위를 확인해 주세요. (논리 0~2, 근거·반영·단계 0~1, 태도 0~-3)", 400);
  }

  const score = await getSpeechScore(scoreId);
  if (!score || score.debate_id !== debateId) return notFound();

  const updated = await editSpeechScore(score, auth.teacherId, { ...parsed.data, total: speechTotal(parsed.data) });
  if (!updated) return jsonError("점수를 고치지 못했어요.", 500);
  await refreshReportTotals(debateId);
  return NextResponse.json({ score: updated });
}
