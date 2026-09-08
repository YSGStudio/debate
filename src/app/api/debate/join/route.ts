import { NextResponse } from "next/server";
import { z } from "zod";
import { getStudentSession } from "@/lib/session/student";
import { getStudentInClass } from "@/lib/db/students";
import { getSession } from "@/lib/db/sessions";
import { joinSession } from "@/lib/db/participations";
import { jsonError, readJson } from "@/lib/api";

/** 찬반을 고르고 토론에 들어간다 (R15). 이미 참여 중이면 기존 입장이 유지된다 (R16). */
export async function POST(req: Request) {
  const s = await getStudentSession();
  if (!s) return jsonError("다시 입장해 주세요.", 401);

  const parsed = z
    .object({ sessionId: z.string().uuid(), stance: z.enum(["pro", "con"]) })
    .safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError("찬성 또는 반대를 골라주세요.", 400);

  const student = await getStudentInClass(s.classId, s.studentId);
  if (!student) return jsonError("다시 입장해 주세요.", 401);

  const session = await getSession(parsed.data.sessionId);
  if (!session || session.class_id !== s.classId) return jsonError("토론을 찾을 수 없어요.", 404);
  if (session.status !== "open") return jsonError("아직 토론이 시작되지 않았어요.", 409);

  const participation = await joinSession(session.id, student.id, parsed.data.stance);
  return NextResponse.json({
    participation: { id: participation.id, stance: participation.stance },
  });
}
