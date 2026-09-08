import { NextResponse } from "next/server";
import { z } from "zod";
import { findClassByJoinCode } from "@/lib/db/classes";
import { listStudents } from "@/lib/db/students";
import { listOpenSessions } from "@/lib/db/sessions";
import { isValidClassCode, normalizeClassCode } from "@/lib/class-code";
import { jsonError, readJson } from "@/lib/api";

/** 학급 코드 조회 (R13). 코드가 맞으면 명단과 열린 토론을 돌려준다. */
export async function POST(req: Request) {
  const parsed = z.object({ code: z.string() }).safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError("코드를 다시 확인해 주세요.", 400);

  const code = normalizeClassCode(parsed.data.code);
  if (!isValidClassCode(code)) return jsonError("코드를 다시 확인해 주세요.", 404);

  const cls = await findClassByJoinCode(code);
  if (!cls) return jsonError("코드를 다시 확인해 주세요.", 404);

  const [students, sessions] = await Promise.all([listStudents(cls.id, true), listOpenSessions(cls.id)]);

  return NextResponse.json({
    class: { id: cls.id, name: cls.name, gradeLevel: cls.grade_level, joinCode: cls.join_code },
    students: students.map((s) => ({ id: s.id, name: s.display_name })),
    sessions: sessions.map((s) => ({ id: s.id, topic: s.topic, description: s.description })),
  });
}
