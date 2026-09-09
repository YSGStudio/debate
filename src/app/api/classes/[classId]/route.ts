import { NextResponse } from "next/server";
import { z } from "zod";
import { classDeletionImpact, deleteClass, getOwnedClass, updateClass } from "@/lib/db/classes";
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

/**
 * 학급 삭제. 학생·토론·대화·채점이 모두 함께 사라진다.
 *
 * `?preview=1` 이면 지우지 않고 무엇이 사라지는지만 돌려준다.
 * 교사가 확인 화면에서 잃을 것을 먼저 보게 하기 위함이다.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ classId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { classId } = await ctx.params;

  const cls = await getOwnedClass(auth.teacherId, classId);
  if (!cls) return notFound();

  const impact = await classDeletionImpact(classId, cls.name);

  if (new URL(req.url).searchParams.get("preview") === "1") {
    return NextResponse.json({ impact });
  }

  // 진행 중인 토론이 있으면 지우지 않는다. 대화하던 학생 화면이 그대로 멈춘다.
  if (impact.openTopics.length > 0) {
    return jsonError(
      `진행 중인 토론이 있습니다: "${impact.openTopics[0]}". 먼저 토론을 종료해 주세요.`,
      409,
      { openTopics: impact.openTopics },
    );
  }

  const ok = await deleteClass(auth.teacherId, classId);
  if (!ok) return jsonError("학급을 지우지 못했습니다.", 500);
  return NextResponse.json({ deleted: true, impact });
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
