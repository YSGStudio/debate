import { NextResponse } from "next/server";
import { z } from "zod";
import { findClassByJoinCode } from "@/lib/db/classes";
import { getStudentInClass } from "@/lib/db/students";
import { normalizeClassCode } from "@/lib/class-code";
import { setStudentSession } from "@/lib/session/student";
import { jsonError, readJson } from "@/lib/api";

/** 학생이 명단에서 자기 이름을 고르면 서명 쿠키를 발급한다 (R14) */
export async function POST(req: Request) {
  const parsed = z
    .object({ code: z.string(), studentId: z.string().uuid() })
    .safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError("다시 시도해 주세요.", 400);

  const cls = await findClassByJoinCode(normalizeClassCode(parsed.data.code));
  if (!cls) return jsonError("코드를 다시 확인해 주세요.", 404);

  const student = await getStudentInClass(cls.id, parsed.data.studentId);
  if (!student) return jsonError("명단에서 이름을 찾지 못했어요.", 404);

  await setStudentSession({ classId: cls.id, studentId: student.id });
  return NextResponse.json({ ok: true, name: student.display_name });
}
