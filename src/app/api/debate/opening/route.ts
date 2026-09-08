import { z } from "zod";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/lib/env";
import { getStudentSession } from "@/lib/session/student";
import { getStudentInClass } from "@/lib/db/students";
import { getSession } from "@/lib/db/sessions";
import { appendMessage, getParticipation, listMessages } from "@/lib/db/participations";
import { takeMessageSlot } from "@/lib/db/rate-limit";
import { buildDebateSystemPrompt, buildOpeningPrompt } from "@/lib/prompts/debate";
import { jsonError, readJson } from "@/lib/api";

export const maxDuration = 60;

const Body = z.object({ sessionId: z.string().uuid() });

/**
 * 챗봇이 먼저 건네는 첫 인사 (R18).
 *
 * 학생 메시지를 만들지 않는다. 따라서 메시지 상한(R21)을 깎지 않고,
 * 판정 대상이 되지도 않으며, 채점 대화 전문에 학생 발언으로 섞이지도 않는다.
 */
export async function POST(req: Request) {
  const s = await getStudentSession();
  if (!s) return jsonError("다시 입장해 주세요.", 401);

  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError("잘못된 요청입니다.", 400);

  const student = await getStudentInClass(s.classId, s.studentId);
  if (!student) return jsonError("다시 입장해 주세요.", 401);

  const session = await getSession(parsed.data.sessionId);
  if (!session || session.class_id !== s.classId) return jsonError("토론을 찾을 수 없어요.", 404);
  if (session.status !== "open") return jsonError("아직 토론이 시작되지 않았어요.", 409);

  const participation = await getParticipation(session.id, student.id);
  if (!participation) return jsonError("먼저 찬성/반대를 골라주세요.", 409);

  // 이미 대화가 시작됐으면 첫 인사를 다시 만들지 않는다.
  const existing = await listMessages(participation.id);
  if (existing.length > 0) return jsonError("이미 토론이 시작됐어요.", 409);

  // 스트림이 끝나기 전(저장 전) 창에서 병렬 호출이 모델을 여러 번 부르는 것을 막는다.
  // 이 경로는 학생 메시지 상한(R37)의 바깥이라 별도 가드가 필요하다.
  if (!(await takeMessageSlot(participation.id))) {
    return jsonError("조금만 기다려줄래요?", 429);
  }

  const promptInput = {
    topic: session.topic,
    description: session.description,
    studentStance: participation.stance,
    grade: session.grade_level,
  };

  const openai = createOpenAI({ apiKey: env.openaiApiKey });
  const result = streamText({
    model: openai(env.debateModel),
    system: buildDebateSystemPrompt(promptInput),
    prompt: buildOpeningPrompt(promptInput),
    temperature: 0.7,
    onEnd: async ({ text }) => {
      try {
        await appendMessage(participation.id, 1, "bot", text);
      } catch (e) {
        console.error("[opening] 첫 인사 저장 실패:", e);
      }
    },
  });

  return result.toTextStreamResponse();
}
