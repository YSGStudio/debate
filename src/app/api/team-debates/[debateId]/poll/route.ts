import { NextResponse } from "next/server";
import { teamPoll } from "@/lib/db/team-debates";
import { isErr, notFound, requireTeacher } from "@/lib/api";

/**
 * 관제실 폴링 (ver2 V-R48, V-R49). 1.5초 간격.
 * 소유권 검사까지 team_poll 안에서 한다 — 폴링 1회 = RPC 1회.
 */
export async function GET(req: Request, ctx: { params: Promise<{ debateId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(debateId)) return notFound();

  const since = Math.max(0, Number(new URL(req.url).searchParams.get("since") ?? 0) || 0);
  const snap = await teamPoll(debateId, { role: "teacher", teacherId: auth.teacherId }, since);
  if (snap.error) return notFound();
  return NextResponse.json(snap, { headers: { "cache-control": "no-store" } });
}
