import { NextResponse } from "next/server";
import { getOwnedSession } from "@/lib/db/sessions";
import { getParticipationById, listMessages } from "@/lib/db/participations";
import { listFlags } from "@/lib/db/flags";
import { getScore } from "@/lib/db/scores";
import { admin } from "@/lib/supabase/admin";
import { isErr, notFound, requireTeacher } from "@/lib/api";

/** 학생 상세 대화 + 문제 메시지 강조용 판정 + 채점 결과 (R31, R54) */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sessionId: string; pid: string }> },
) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { sessionId, pid } = await ctx.params;

  const owned = await getOwnedSession(auth.teacherId, sessionId);
  if (!owned) return notFound();

  const participation = await getParticipationById(pid);
  if (!participation || participation.session_id !== sessionId) return notFound();

  const { data: student } = await admin()
    .from("students")
    .select("display_name")
    .eq("id", participation.student_id)
    .maybeSingle();

  const [messages, flags, score] = await Promise.all([
    listMessages(pid),
    listFlags(pid),
    getScore(pid),
  ]);

  const flagByMessage = new Map(flags.map((f) => [f.message_id, f]));

  return NextResponse.json({
    student: { name: (student as { display_name: string } | null)?.display_name ?? "(이름 없음)" },
    stance: participation.stance,
    messageCount: participation.student_message_count,
    messages: messages.map((m) => {
      const f = flagByMessage.get(m.id);
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
        verdict: f?.verdict ?? null,
        reason: f?.reason ?? null,
        triageFailed: f?.triage_failed ?? false,
        flagId: f?.id ?? null,
        acknowledged: Boolean(f?.acknowledged_at),
      };
    }),
    score: score
      ? {
          status: score.status,
          total: score.total,
          scores: {
            evidence: score.score_evidence,
            listening: score.score_listening,
            development: score.score_development,
            expression: score.score_expression,
          },
          reasons: score.reasons,
          strengths: score.strengths,
          nextStep: score.next_step,
          error: score.error,
        }
      : null,
  });
}
