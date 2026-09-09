import { getOwnedSession } from "@/lib/db/sessions";
import { dashboardSnapshot } from "@/lib/db/dashboard";
import { listMessages, listParticipations } from "@/lib/db/participations";
import { listFlags } from "@/lib/db/flags";
import { getScore } from "@/lib/db/scores";
import { admin } from "@/lib/supabase/admin";
import { renderReportPdf, type ReportStudent } from "@/lib/pdf/report";
import { isErr, notFound, requireTeacher } from "@/lib/api";

export const maxDuration = 120;

/** 세션 전체 PDF (R34, R35, R36, R44, R56) */
export async function GET(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { sessionId } = await ctx.params;

  const owned = await getOwnedSession(auth.teacherId, sessionId);
  if (!owned) return notFound();

  const snap = await dashboardSnapshot(sessionId);
  if (!snap?.session) return notFound();

  const participations = await listParticipations(sessionId);
  const byStudent = new Map(participations.map((p) => [p.student_id, p]));

  const students: ReportStudent[] = [];
  for (const row of snap.students) {
    const p = byStudent.get(row.student_id);
    if (!p) {
      students.push({ name: row.display_name, stance: null, messageCount: 0, messages: [], score: null });
      continue;
    }
    const [messages, flags, score] = await Promise.all([
      listMessages(p.id),
      listFlags(p.id),
      getScore(p.id),
    ]);
    const verdictByMessage = new Map(flags.map((f) => [f.message_id, f.verdict]));
    students.push({
      name: row.display_name,
      stance: p.stance,
      messageCount: p.student_message_count,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        verdict: verdictByMessage.get(m.id) ?? null,
      })),
      score: score
        ? {
            status: score.status,
            total: score.total,
            baseTotal: score.base_total,
            offTopicPenalty: score.off_topic_penalty,
            scores: {
              claim: score.score_claim,
              evidence: score.score_evidence,
              counter: score.score_counter,
              development: score.score_development,
              participation: score.score_participation,
            },
            reasons: score.reasons,
            strengths: score.strengths,
            nextStep: score.next_step,
            analysis: score.analysis,
            changeSummary: score.change_summary,
            changeReason: score.change_reason,
          }
        : null,
    });
  }

  const { data: teacher } = await admin()
    .from("teachers")
    .select("name")
    .eq("id", auth.teacherId)
    .maybeSingle();
  void teacher;

  const pdf = await renderReportPdf({
    className: snap.session.class_name,
    gradeLevel: snap.session.grade_level,
    topic: snap.session.topic,
    description: snap.session.description,
    status: snap.session.status,
    generatedAt: new Date().toLocaleDateString("ko-KR"),
    summary: snap.summary,
    students,
  });

  const filename = encodeURIComponent(`토론기록_${snap.session.topic.slice(0, 20)}.pdf`);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
