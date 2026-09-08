import { NextResponse } from "next/server";
import { getParticipationById } from "@/lib/db/participations";
import { getOwnedSession } from "@/lib/db/sessions";
import { runScoring } from "@/lib/scoring-service";
import { isErr, jsonError, notFound, requireTeacher } from "@/lib/api";

/** 교사의 다시 채점 (R52). 실패한 건에 대해서만 동작한다. */
export async function POST(_req: Request, ctx: { params: Promise<{ pid: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { pid } = await ctx.params;

  const participation = await getParticipationById(pid);
  if (!participation) return notFound();

  const owned = await getOwnedSession(auth.teacherId, participation.session_id);
  if (!owned) return notFound();

  const result = await runScoring(pid, { retry: true });
  if (result === "already") return jsonError("다시 채점할 수 있는 상태가 아닙니다.", 409);
  return NextResponse.json({ result });
}
