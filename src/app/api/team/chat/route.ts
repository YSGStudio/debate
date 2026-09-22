import { NextResponse } from "next/server";
import { z } from "zod";
import { teamChat } from "@/lib/db/team-debates";
import { takeSlot } from "@/lib/db/rate-limit";
import { runInBackground } from "@/lib/background";
import { moderateTeamMessage } from "@/lib/team-scoring-service";
import { CHAT_INTERVAL_MS, CHAT_MAX_LEN, SPEECH_MAX_LEN } from "@/lib/team/rules";
import { isErr, jsonError, readJson } from "@/lib/api";
import { DebateId, requireTeamStudent, teamResultResponse } from "@/lib/team/student-api";

const Body = z.object({
  debateId: DebateId,
  content: z.string().trim().min(1, "할 말을 적어주세요."),
  /** 차례가 넘어가 못 보낸 발언을 팀 채팅에 남긴다 (V-R26) */
  draft: z.boolean().optional(),
});

/**
 * 팀 채팅 (ver2 V-R8, V-R28). 자기 팀 채널에만 쓴다. 2초에 1회.
 * AI 를 부르지 않는다 (V-R50). 부적절 판정만 뒤에서 돈다 (V-R46).
 */
export async function POST(req: Request) {
  const auth = await requireTeamStudent();
  if (isErr(auth)) return auth.response;

  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "글을 다시 확인해 주세요.", 400);
  const { debateId, content } = parsed.data;
  const draft = parsed.data.draft ?? false;

  const max = draft ? SPEECH_MAX_LEN : CHAT_MAX_LEN;
  if (content.length > max) return jsonError(`${max}자 안에서 써주세요.`, 400);

  // 못 보낸 발언은 채팅과 별도 칸으로 센다 — 채팅 직후 자동 저장이 429 로 사라지지 않게
  const key = `${draft ? "tdraft" : "tchat"}:${debateId}:${auth.studentId}`;
  if (!(await takeSlot(key, CHAT_INTERVAL_MS))) {
    return jsonError("조금만 천천히 써줄래요?", 429);
  }

  const r = await teamChat(debateId, auth, content, draft);
  const denied = teamResultResponse(r.result);
  if (denied) return denied;

  const messageId = r.messageId as string;
  runInBackground(
    moderateTeamMessage({ debateId, messageId, content }),
    "team/부적절 판정",
  );
  return NextResponse.json({ messageId });
}
