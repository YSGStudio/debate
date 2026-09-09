import { z } from "zod";
import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/lib/env";
import { getStudentSession } from "@/lib/session/student";
import { getStudentInClass } from "@/lib/db/students";
import { getSession } from "@/lib/db/sessions";
import {
  appendMessage,
  bumpStudentMessageCount,
  getParticipation,
  listMessages,
  nextSeq,
} from "@/lib/db/participations";
import { saveFlag } from "@/lib/db/flags";
import { takeMessageSlot } from "@/lib/db/rate-limit";
import { triageMessage } from "@/lib/ai/triage";
import { runScoring } from "@/lib/scoring-service";
import { runInBackground } from "@/lib/background";
import { buildDebateSystemPrompt } from "@/lib/prompts/debate";
import { jsonError, readJson } from "@/lib/api";

export const maxDuration = 60;

const MAX_LEN = 500;

const Body = z.object({
  sessionId: z.string().uuid(),
  content: z.string().trim().min(1, "할 말을 적어주세요.").max(MAX_LEN, "500자 안에서 써주세요."),
});

/**
 * 학생 메시지 -> 챗봇 응답 스트리밍 (R20~R27, R37, R38).
 *
 * 순서: 인증 -> 상태/상한/속도 검사 -> 학생 메시지 저장 -> (판정 병렬 시작) -> 스트리밍
 * 판정 실패는 응답을 막지 않는다.
 */
export async function POST(req: Request) {
  const s = await getStudentSession();
  if (!s) return jsonError("다시 입장해 주세요.", 401);

  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "할 말을 적어주세요.", 400);
  }

  const student = await getStudentInClass(s.classId, s.studentId);
  if (!student) return jsonError("다시 입장해 주세요.", 401);

  const session = await getSession(parsed.data.sessionId);
  if (!session || session.class_id !== s.classId) return jsonError("토론을 찾을 수 없어요.", 404);

  // 교사가 종료한 세션에는 더 보낼 수 없다 (R22)
  if (session.status !== "open") {
    return jsonError("토론이 끝났어요.", 409, { locked: true, lockReason: "closed" });
  }

  const participation = await getParticipation(session.id, student.id);
  if (!participation) return jsonError("먼저 찬성/반대를 골라주세요.", 409);

  // 메시지 상한 (R21, R37)
  if (participation.student_message_count >= session.message_limit) {
    return jsonError("오늘 토론은 여기까지예요.", 409, { locked: true, lockReason: "limit" });
  }

  // 5초에 1회 (R38)
  if (!(await takeMessageSlot(participation.id))) {
    return jsonError("조금만 천천히 말해줄래요?", 429);
  }

  const history = await listMessages(participation.id);
  const seq = await nextSeq(participation.id);
  const saved = await appendMessage(participation.id, seq, "student", parsed.data.content);

  const newCount = participation.student_message_count + 1;
  await bumpStudentMessageCount(participation.id, newCount);

  // 판정과 길잡이 안내는 응답 스트리밍과 병렬로 돈다. await 하지 않는다 (R27).
  // 반론에 제대로 답했는지 보려면 학생이 답한 직전 챗봇 발언이 필요하다.
  const botPrevious = [...history].reverse().find((m) => m.role === "bot")?.content ?? null;
  runInBackground(
    triageMessage(
      { topic: session.topic, grade: session.grade_level, botPrevious },
      parsed.data.content,
    ).then((t) =>
      saveFlag({
        messageId: saved.id,
        participationId: participation.id,
        verdict: t.verdict,
        reason: t.reason,
        triageFailed: t.failed,
        coachKind: t.coachKind,
        coachMessage: t.coachMessage,
      }),
    ),
    "message/판정",
  );

  const openai = createOpenAI({ apiKey: env.openaiApiKey });
  const result = streamText({
    model: openai(env.debateModel),
    system: buildDebateSystemPrompt({
      topic: session.topic,
      description: session.description,
      studentStance: participation.stance,
      grade: session.grade_level,
    }),
    messages: [
      ...history.map((m) => ({
        role: (m.role === "student" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: parsed.data.content },
    ],
    temperature: 0.7,
    onEnd: async ({ text }) => {
      try {
        await appendMessage(participation.id, seq + 1, "bot", text);
      } catch (e) {
        console.error("[message] 챗봇 응답 저장 실패:", e);
      }
      // 상한에 도달했으면 여기서 채점을 시작한다 (R45).
      if (newCount >= session.message_limit) {
        await runScoring(participation.id).catch((e) =>
          console.error("[message] 상한 도달 채점 실패:", e),
        );
      }
    },
  });

  return result.toTextStreamResponse({
    headers: {
      "x-message-count": String(newCount),
      "x-message-limit": String(session.message_limit),
    },
  });
}
