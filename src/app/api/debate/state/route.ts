import { NextResponse } from "next/server";
import { getStudentSession } from "@/lib/session/student";
import { getStudentInClass } from "@/lib/db/students";
import { getOwnedClassless } from "@/lib/db/session-helpers";
import { listOpenTeamDebatesForStudent } from "@/lib/db/team-debates";
import { jsonError } from "@/lib/api";

/**
 * 학생 화면 상태 폴링 (R22).
 * 세션이 닫히면 최대 10초 안에 학생 화면이 잠기도록 클라이언트가 5초 간격으로 부른다.
 */
export async function GET(req: Request) {
  const s = await getStudentSession();
  if (!s) return jsonError("다시 입장해 주세요.", 401);

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");

  const student = await getStudentInClass(s.classId, s.studentId);
  if (!student) return jsonError("다시 입장해 주세요.", 401);

  const [state, teamDebates] = await Promise.all([
    getOwnedClassless(s.classId, s.studentId, sessionId),
    // 자기가 배정된 열린 팀 토론만 (ver2 V-R6)
    listOpenTeamDebatesForStudent(s.classId, s.studentId),
  ]);
  return NextResponse.json({ ...state, teamDebates });
}
