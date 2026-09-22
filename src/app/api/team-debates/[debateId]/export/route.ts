import { getOwnedTeamDebate } from "@/lib/db/team-debates";
import { getTeacherReport } from "@/lib/team-scoring-service";
import { renderTeamReportPdf } from "@/lib/pdf/team-report";
import { isErr, notFound, requireTeacher } from "@/lib/api";

export const maxDuration = 120;

/** 팀 토론 결과 PDF (ver2 V-R45). 팀 채팅은 넣지 않는다. */
export async function GET(_req: Request, ctx: { params: Promise<{ debateId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();

  const r = await getTeacherReport(debateId);
  if (!r) return notFound();

  const pdf = await renderTeamReportPdf({
    className: owned.className,
    gradeLevel: r.debate.grade_level,
    topic: r.debate.topic,
    description: r.debate.description,
    generatedAt: new Date().toLocaleDateString("ko-KR"),
    teamNames: { pro: r.debate.pro_name, con: r.debate.con_name },
    reportReady: r.report?.status === "done" || r.report?.status === "skipped",
    totals: r.totals,
    winner: r.winner,
    feedback: r.report?.status === "done" ? r.report.feedback : null,
    members: r.members,
    penalties: r.penalties,
    floor: r.floor.filter((m) => m.kind !== "system" || m.content.length > 0),
  });

  const filename = encodeURIComponent(`팀토론_${r.debate.topic.slice(0, 20)}.pdf`);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
