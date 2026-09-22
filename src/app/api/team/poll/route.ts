import { NextResponse } from "next/server";
import { teamPoll } from "@/lib/db/team-debates";
import { isErr, jsonError } from "@/lib/api";
import { DebateId, requireTeamStudent, teamResultResponse } from "@/lib/team/student-api";

/**
 * 학생 폴링 (ver2 V-R8, V-R15, V-R49). 1.5초 간격.
 * DB 왕복은 team_poll RPC 한 번이다. 자기 팀 채널만, 공개 방식에 따라 점수를 뺀 채로 온다.
 */
export async function GET(req: Request) {
  const auth = await requireTeamStudent();
  if (isErr(auth)) return auth.response;

  const url = new URL(req.url);
  const debateId = DebateId.safeParse(url.searchParams.get("debateId"));
  if (!debateId.success) return jsonError("토론을 찾을 수 없어요.", 404);
  const since = Math.max(0, Number(url.searchParams.get("since") ?? 0) || 0);

  const snap = await teamPoll(debateId.data, { role: "student", ...auth }, since);
  if (typeof snap.error === "string") return teamResultResponse(snap.error) ?? jsonError("다시 시도해 주세요.", 500);
  return NextResponse.json(snap, { headers: { "cache-control": "no-store" } });
}
