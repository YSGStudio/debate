import { NextResponse } from "next/server";
import { getStudentSession } from "@/lib/session/student";
import { getSession } from "@/lib/db/sessions";
import { getParticipation } from "@/lib/db/participations";
import { getScore } from "@/lib/db/scores";
import { jsonError } from "@/lib/api";

/**
 * 학생 본인의 채점 결과 (R53).
 * 다른 학생 정보나 반 평균은 절대 담지 않는다.
 */
export async function GET(req: Request) {
  const s = await getStudentSession();
  if (!s) return jsonError("다시 입장해 주세요.", 401);

  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) return jsonError("토론을 찾을 수 없어요.", 400);

  const session = await getSession(sessionId);
  if (!session || session.class_id !== s.classId) return jsonError("토론을 찾을 수 없어요.", 404);

  const participation = await getParticipation(session.id, s.studentId);
  if (!participation) return jsonError("참여 기록이 없어요.", 404);

  const score = await getScore(participation.id);

  return NextResponse.json({
    topic: session.topic,
    stance: participation.stance,
    messageCount: participation.student_message_count,
    score: score
      ? {
          status: score.status,
          total: score.total,
          scores:
            score.status === "done"
              ? {
                  evidence: score.score_evidence,
                  listening: score.score_listening,
                  development: score.score_development,
                  expression: score.score_expression,
                }
              : null,
          reasons: score.reasons,
          strengths: score.strengths,
          nextStep: score.next_step,
        }
      : null,
  });
}
