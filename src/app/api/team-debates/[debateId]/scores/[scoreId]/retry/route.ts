import { NextResponse } from "next/server";
import { getOwnedTeamDebate, getSpeechScore, getTeamMessage } from "@/lib/db/team-debates";
import { runSpeechJudging } from "@/lib/team-scoring-service";
import { isErr, jsonError, notFound, requireTeacher } from "@/lib/api";

export const maxDuration = 60;

/**
 * 다시 채점 (ver2 V-R35). 교사가 눌렀을 때만.
 * `scoreId` 자리에 채점 행이 아직 없는 발언의 메시지 id 를 줘도 된다 (채점이 아예 시작되지 못한 경우).
 * 교사가 고친 점수는 덮지 않는다 (V-R36).
 */
export async function POST(_req: Request, ctx: { params: Promise<{ debateId: string; scoreId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId, scoreId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();

  const score = await getSpeechScore(scoreId);
  let result: Awaited<ReturnType<typeof runSpeechJudging>>;
  if (score) {
    if (score.debate_id !== debateId) return notFound();
    if (score.edited_at) return jsonError("선생님이 고친 점수는 다시 채점하지 않아요.", 409);
    if (score.status !== "failed") return jsonError("채점에 실패한 발언만 다시 채점할 수 있어요.", 409);
    result = await runSpeechJudging(score.message_id, { retryScoreId: score.id });
  } else {
    const msg = await getTeamMessage(scoreId);
    if (!msg || msg.debate_id !== debateId || msg.kind !== "speech") return notFound();
    result = await runSpeechJudging(msg.id);
  }

  if (result === "already") return jsonError("이미 채점 중이에요.", 409);
  return NextResponse.json({ result });
}
