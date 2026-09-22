import { NextResponse } from "next/server";
import { z } from "zod";
import { teamClaim } from "@/lib/db/team-debates";
import { isErr, jsonError, readJson } from "@/lib/api";
import { DebateId, requireTeamStudent, teamResultResponse } from "@/lib/team/student-api";

/**
 * "발언 중" 잠금 획득·연장 (ver2 V-R24, V-R27).
 * 입력창에 글을 쓰는 동안 3초마다 부른다. 20초 동안 안 부르면 잠금이 풀린다.
 */
export async function POST(req: Request) {
  const auth = await requireTeamStudent();
  if (isErr(auth)) return auth.response;

  const parsed = z.object({ debateId: DebateId }).safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError("토론을 찾을 수 없어요.", 404);

  const r = await teamClaim(parsed.data.debateId, auth);
  return teamResultResponse(r.result, r.holder) ?? NextResponse.json({ locked: true });
}
