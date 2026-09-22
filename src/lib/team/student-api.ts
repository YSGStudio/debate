import "server-only";
import type { NextResponse } from "next/server";
import { z } from "zod";
import { getStudentSession } from "@/lib/session/student";
import { getDeviceId } from "@/lib/session/team-device";
import { jsonError } from "@/lib/api";
import type { StudentIdentity } from "@/lib/db/team-debates";

/** 학생 팀 토론 요청의 공통 인증: ss_token(학급·학생) + td_device(기기) */
export async function requireTeamStudent(): Promise<StudentIdentity | { response: NextResponse }> {
  const s = await getStudentSession();
  if (!s) return { response: jsonError("다시 입장해 주세요.", 401) };
  return { classId: s.classId, studentId: s.studentId, deviceId: await getDeviceId() };
}

export const DebateId = z.string().uuid();

/** SQL 함수의 결과 코드를 HTTP 응답으로 바꾼다. ok 는 null (호출부가 처리). */
export function teamResultResponse(result: string, holder?: string | null): NextResponse | null {
  switch (result) {
    case "ok":
      return null;
    case "not_found":
      return jsonError("토론을 찾을 수 없어요.", 404);
    case "replaced":
      return jsonError("다른 기기에서 들어왔어요.", 409, { code: "replaced" });
    case "not_entered":
      return jsonError("다시 들어와 주세요.", 409, { code: "not_entered" });
    case "not_your_turn":
      return jsonError("지금은 상대 팀 차례예요.", 409, { code: result });
    case "locked":
      return jsonError(`${holder ?? "다른"} 친구가 쓰고 있어요.`, 409, { code: result, holder: holder ?? null });
    case "no_lock":
      return jsonError("먼저 입력창을 눌러 발언 차례를 잡아요.", 409, { code: result });
    case "balance_wait":
      return jsonError("아직 말하지 않은 친구에게 먼저 기회를 줄게요.", 409, { code: result });
    case "paused":
      return jsonError("잠깐 멈췄어요. 선생님을 기다려요.", 409, { code: result });
    case "closed":
      return jsonError("지금은 토론방에 쓸 수 없어요.", 409, { code: result });
    case "read_only":
      return jsonError("지금은 팀 채팅을 쓸 수 없어요.", 409, { code: result });
    case "invalid":
      return jsonError("글을 다시 확인해 주세요.", 400, { code: result });
    default:
      return jsonError("다시 시도해 주세요.", 500);
  }
}
