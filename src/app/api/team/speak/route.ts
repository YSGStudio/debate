import { NextResponse } from "next/server";
import { z } from "zod";
import { teamSpeak } from "@/lib/db/team-debates";
import { runInBackground } from "@/lib/background";
import { moderateTeamMessage, runSpeechJudging } from "@/lib/team-scoring-service";
import { SPEECH_MAX_LEN } from "@/lib/team/rules";
import { isErr, jsonError, readJson } from "@/lib/api";
import { DebateId, requireTeamStudent, teamResultResponse } from "@/lib/team/student-api";

// 채점은 응답 뒤에서 돈다: 15초 타임아웃 × 2 + 재시도 대기 5초
export const maxDuration = 60;

const Body = z.object({
  debateId: DebateId,
  content: z
    .string()
    .trim()
    .min(1, "할 말을 적어주세요.")
    .max(SPEECH_MAX_LEN, `${SPEECH_MAX_LEN}자 안에서 써주세요.`),
});

/**
 * 전체 토론방 발언 (ver2 V-R20, V-R25, V-R30, V-R46).
 *
 * 차례·잠금·일시정지 검사와 저장, 차례 넘김은 team_speak 한 트랜잭션에서 한다.
 * 채점과 부적절 판정은 뒤에서 돈다. 둘 다 실패해도 발언과 차례 이동은 이미 끝났다.
 */
export async function POST(req: Request) {
  const auth = await requireTeamStudent();
  if (isErr(auth)) return auth.response;

  const raw = await readJson<{ debateId?: unknown }>(req);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const idOk = DebateId.safeParse(raw?.debateId).success;
    if (!idOk) return jsonError("토론을 찾을 수 없어요.", 404);
    return jsonError(parsed.error.issues[0]?.message ?? "글을 다시 확인해 주세요.", 400);
  }

  const { debateId, content } = parsed.data;
  const r = await teamSpeak(debateId, auth, content);
  const denied = teamResultResponse(r.result);
  if (denied) return denied;

  const messageId = r.messageId as string;
  runInBackground(runSpeechJudging(messageId), "team/발언 채점");
  runInBackground(
    moderateTeamMessage({ debateId, messageId, content }),
    "team/부적절 판정",
  );

  return NextResponse.json({ messageId, seq: r.seq });
}
