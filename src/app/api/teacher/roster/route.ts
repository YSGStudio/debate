import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { listClasses } from "@/lib/db/classes";
import { bulkAddStudents, listStudents, removeOrDeactivateStudent } from "@/lib/db/students";
import { isErr, jsonError, readJson, requireTeacher } from "@/lib/api";
import { invalidNames, parseRoster } from "@/lib/roster";

const AddBody = z.object({ raw: z.string().min(1) });
const DeleteBody = z.object({ id: z.string().uuid() });

export async function GET() {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { data, error } = await admin().from("teacher_roster")
    .select("id, display_name").eq("teacher_id", auth.teacherId).order("display_name");
  if (error) return jsonError("명단을 불러오지 못했습니다.", 500);
  return NextResponse.json({ students: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const body = AddBody.safeParse(await readJson(req));
  if (!body.success) return jsonError("이름을 입력해 주세요.", 400);
  const { names, duplicates } = parseRoster(body.data.raw);
  if (!names.length || duplicates.length || invalidNames(names).length) {
    return jsonError("빈 이름, 중복된 이름 또는 20자가 넘는 이름을 확인해 주세요.", 400);
  }
  const { data: existing, error: readError } = await admin().from("teacher_roster")
    .select("display_name").eq("teacher_id", auth.teacherId);
  if (readError) return jsonError("명단을 확인하지 못했습니다.", 500);
  const current = new Set(((existing ?? []) as { display_name: string }[]).map((row) => row.display_name));
  const conflicts = names.filter((name) => current.has(name));
  if (conflicts.length) return jsonError(`이미 등록된 이름입니다: ${conflicts.join(", ")}`, 409);
  const { error } = await admin().from("teacher_roster")
    .insert(names.map((display_name) => ({ teacher_id: auth.teacherId, display_name })));
  if (error) return jsonError("명단을 등록하지 못했습니다. 중복 이름을 확인해 주세요.", 409);
  const classes = await listClasses(auth.teacherId);
  try {
    for (const cls of classes) {
      const existingStudents = await listStudents(cls.id);
      const classNames = new Set(existingStudents.map((student) => student.display_name));
      const missing = names.filter((name) => !classNames.has(name));
      if (missing.length) {
        const result = await bulkAddStudents(cls.id, missing);
        if (!result.ok) throw new Error("명단 동기화 실패");
      }
      const inactive = existingStudents.filter((student) => names.includes(student.display_name) && !student.is_active);
      if (inactive.length) {
        const { error: reactivateError } = await admin().from("students")
          .update({ is_active: true }).in("id", inactive.map((student) => student.id));
        if (reactivateError) throw reactivateError;
      }
    }
  } catch {
    return jsonError("공통 명단은 저장됐지만 일부 토론에 반영하지 못했습니다.", 500);
  }
  return NextResponse.json({ added: names.length });
}

export async function DELETE(req: Request) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const body = DeleteBody.safeParse(await readJson(req));
  if (!body.success) return jsonError("학생을 확인해 주세요.", 400);
  const { data: student } = await admin().from("teacher_roster")
    .select("id, display_name").eq("id", body.data.id).eq("teacher_id", auth.teacherId).maybeSingle();
  if (!student) return jsonError("학생을 찾지 못했습니다.", 404);
  const classes = await listClasses(auth.teacherId);
  for (const cls of classes) {
    const match = (await listStudents(cls.id)).find((row) => row.display_name === student.display_name && row.is_active);
    if (match) await removeOrDeactivateStudent(cls.id, match.id);
  }
  const { error } = await admin().from("teacher_roster")
    .delete().eq("id", body.data.id).eq("teacher_id", auth.teacherId);
  if (error) return jsonError("명단에서 삭제하지 못했습니다.", 500);
  return NextResponse.json({ ok: true });
}
