import { NextResponse } from "next/server";
import { z } from "zod";
import { teamEnter } from "@/lib/db/team-debates";
import { ensureDeviceId } from "@/lib/session/team-device";
import { isErr, jsonError, readJson } from "@/lib/api";
import { DebateId, requireTeamStudent, teamResultResponse } from "@/lib/team/student-api";

/**
 * 학생이 팀 토론 화면에 들어온다 (ver2 V-R6, V-R9).
 * 이 기기를 "지금 쓰는 기기" 로 등록한다. 다른 기기가 쓰고 있었으면 그 기기는 끊긴다.
 */
export async function POST(req: Request) {
  const auth = await requireTeamStudent();
  if (isErr(auth)) return auth.response;

  const parsed = z.object({ debateId: DebateId }).safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError("토론을 찾을 수 없어요.", 404);

  const deviceId = await ensureDeviceId();
  const result = await teamEnter(parsed.data.debateId, { ...auth, deviceId });
  return teamResultResponse(result) ?? NextResponse.json({ entered: true });
}
