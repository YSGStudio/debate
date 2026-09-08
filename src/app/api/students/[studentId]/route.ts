import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { getOwnedClass } from "@/lib/db/classes";
import { removeOrDeactivateStudent, renameStudent } from "@/lib/db/students";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";
import { MAX_NAME_LENGTH } from "@/lib/roster";

async function classIdOfStudent(studentId: string): Promise<string | null> {
  const { data } = await admin().from("students").select("class_id").eq("id", studentId).maybeSingle();
  return (data as { class_id: string } | null)?.class_id ?? null;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { studentId } = await ctx.params;

  const classId = await classIdOfStudent(studentId);
  if (!classId || !(await getOwnedClass(auth.teacherId, classId))) return notFound();

  const parsed = z.object({ name: z.string().min(1).max(MAX_NAME_LENGTH) }).safeParse(await readJson(req));
  if (!parsed.success) return jsonError("이름을 확인해 주세요.", 400);

  const ok = await renameStudent(classId, studentId, parsed.data.name.trim());
  if (!ok) return jsonError("이미 있는 이름입니다.", 409);
  return NextResponse.json({ ok: true });
}

/** 삭제 (R7). 메시지를 남긴 학생은 비활성 처리된다. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ studentId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { studentId } = await ctx.params;

  const classId = await classIdOfStudent(studentId);
  if (!classId || !(await getOwnedClass(auth.teacherId, classId))) return notFound();

  const result = await removeOrDeactivateStudent(classId, studentId);
  if (result === "not_found") return notFound();
  return NextResponse.json({ result });
}
