import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedClass, updateClass } from "@/lib/db/classes";
import { listStudents } from "@/lib/db/students";
import { listSessions } from "@/lib/db/sessions";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";
import { GRADE_LEVELS } from "@/lib/grade-presets";

const Patch = z.object({
  name: z.string().min(1).max(40).optional(),
  gradeLevel: z
    .number()
    .int()
    .refine((v) => (GRADE_LEVELS as readonly number[]).includes(v), "학년은 3~6만 가능합니다.")
    .optional(),
  singleActiveSession: z.boolean().optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ classId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { classId } = await ctx.params;

  const cls = await getOwnedClass(auth.teacherId, classId);
  if (!cls) return notFound();

  return NextResponse.json({
    class: cls,
    students: await listStudents(classId),
    sessions: await listSessions(classId),
  });
}

/** 학급 수정 (R40, R11) */
export async function PATCH(req: Request, ctx: { params: Promise<{ classId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { classId } = await ctx.params;

  const parsed = Patch.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "입력을 확인해 주세요.", 400);

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.gradeLevel !== undefined) patch.grade_level = parsed.data.gradeLevel;
  if (parsed.data.singleActiveSession !== undefined)
    patch.single_active_session = parsed.data.singleActiveSession;

  const updated = await updateClass(auth.teacherId, classId, patch);
  if (!updated) return notFound();
  return NextResponse.json({ class: updated });
}
