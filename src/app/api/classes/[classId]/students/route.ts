import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedClass } from "@/lib/db/classes";
import { addStudent, bulkAddStudents, listStudents } from "@/lib/db/students";
import { invalidNames, MAX_NAME_LENGTH, parseRoster } from "@/lib/roster";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";

const Body = z.union([
  z.object({ mode: z.literal("bulk"), raw: z.string().min(1, "이름을 입력해 주세요.") }),
  z.object({ mode: z.literal("single"), name: z.string().min(1).max(MAX_NAME_LENGTH) }),
]);

/** 명단 등록 (R6, R7) */
export async function POST(req: Request, ctx: { params: Promise<{ classId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { classId } = await ctx.params;

  const cls = await getOwnedClass(auth.teacherId, classId);
  if (!cls) return notFound();

  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError("입력을 확인해 주세요.", 400);

  if (parsed.data.mode === "single") {
    const created = await addStudent(classId, parsed.data.name.trim());
    if (!created) return jsonError(`이미 있는 이름입니다: ${parsed.data.name}`, 409);
    return NextResponse.json({ students: await listStudents(classId) });
  }

  const { names, duplicates } = parseRoster(parsed.data.raw);
  if (names.length === 0) return jsonError("이름을 한 개 이상 입력해 주세요.", 400);
  if (duplicates.length > 0) {
    return jsonError(`붙여넣은 명단 안에 같은 이름이 있습니다: ${duplicates.join(", ")}`, 409, {
      duplicates,
    });
  }
  const tooLong = invalidNames(names);
  if (tooLong.length > 0) {
    return jsonError(`이름이 너무 깁니다(${MAX_NAME_LENGTH}자 이내): ${tooLong.join(", ")}`, 400);
  }

  const result = await bulkAddStudents(classId, names);
  if (!result.ok) {
    return jsonError(`이미 명단에 있는 이름입니다: ${result.conflicts.join(", ")}`, 409, {
      duplicates: result.conflicts,
    });
  }
  return NextResponse.json({ added: result.added, students: await listStudents(classId) });
}
