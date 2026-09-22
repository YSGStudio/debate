import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { getStudentResult } from "@/lib/team-scoring-service";
import { isErr, jsonError } from "@/lib/api";
import { DebateId, requireTeamStudent } from "@/lib/team/student-api";

/**
 * 학생 결과 (ver2 V-R43). 선생님이 "결과 공개" 를 누르기 전엔 준비 중.
 * 응답 키는 topic / teams / winner / stageScores / feedback / pendingCount 뿐이다.
 * 학생 이름·발언 수·개인 잘한 점·개인 점수를 담지 않는다.
 */
export async function GET(req: Request) {
  const auth = await requireTeamStudent();
  if (isErr(auth)) return auth.response;

  const debateId = DebateId.safeParse(new URL(req.url).searchParams.get("debateId"));
  if (!debateId.success) return jsonError("토론을 찾을 수 없어요.", 404);

  // 이 토론에 배정된 학생만 본다. 기기는 따지지 않는다 (결과 보기는 어느 기기에서든).
  const { data } = await admin().rpc("team_resolve_member", {
    p_debate_id: debateId.data,
    p_class_id: auth.classId,
    p_student_id: auth.studentId,
    p_device: auth.deviceId,
  });
  const code = ((data ?? []) as { code: string }[])[0]?.code ?? "not_found";
  if (code === "not_found") return jsonError("토론을 찾을 수 없어요.", 404);

  const result = await getStudentResult(debateId.data);
  if (!result) return jsonError("토론을 찾을 수 없어요.", 404);
  return NextResponse.json(result);
}
