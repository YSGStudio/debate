import "server-only";
import { admin } from "@/lib/supabase/admin";
import { generateClassCode } from "@/lib/class-code";
import { UNIQUE_VIOLATION, type ClassRow } from "./types";

const CLASS_COLS = "id, teacher_id, name, grade_level, join_code, single_active_session, created_at, archived_at";

/** 코드 충돌 시 재시도하며 학급을 만든다 (R5) */
export async function createClass(
  teacherId: string,
  name: string,
  gradeLevel: number,
): Promise<ClassRow> {
  for (let i = 0; i < 8; i++) {
    const { data, error } = await admin()
      .from("classes")
      .insert({ teacher_id: teacherId, name, grade_level: gradeLevel, join_code: generateClassCode() })
      .select(CLASS_COLS)
      .single();
    if (!error) return data as ClassRow;
    if (error.code !== UNIQUE_VIOLATION) throw new Error(`학급 생성 실패: ${error.message}`);
  }
  throw new Error("학급 코드를 만들지 못했습니다. 다시 시도해 주세요.");
}

export async function listClasses(teacherId: string): Promise<ClassRow[]> {
  const { data } = await admin()
    .from("classes")
    .select(CLASS_COLS)
    .eq("teacher_id", teacherId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as ClassRow[];
}

/** 소유권 검사를 겸한다. 남의 학급이면 null (R4) */
export async function getOwnedClass(teacherId: string, classId: string): Promise<ClassRow | null> {
  const { data } = await admin()
    .from("classes")
    .select(CLASS_COLS)
    .eq("id", classId)
    .eq("teacher_id", teacherId)
    .maybeSingle();
  return (data as ClassRow) ?? null;
}

export async function updateClass(
  teacherId: string,
  classId: string,
  patch: Partial<Pick<ClassRow, "name" | "grade_level" | "single_active_session">>,
): Promise<ClassRow | null> {
  const { data } = await admin()
    .from("classes")
    .update(patch)
    .eq("id", classId)
    .eq("teacher_id", teacherId)
    .select(CLASS_COLS)
    .maybeSingle();
  return (data as ClassRow) ?? null;
}

/** 학급 코드 재발급. 이전 코드는 즉시 무효가 된다 (R8) */
export async function rotateJoinCode(teacherId: string, classId: string): Promise<ClassRow | null> {
  for (let i = 0; i < 8; i++) {
    const { data, error } = await admin()
      .from("classes")
      .update({ join_code: generateClassCode() })
      .eq("id", classId)
      .eq("teacher_id", teacherId)
      .select(CLASS_COLS)
      .maybeSingle();
    if (!error) return (data as ClassRow) ?? null;
    if (error.code !== UNIQUE_VIOLATION) throw new Error(`코드 재발급 실패: ${error.message}`);
  }
  throw new Error("학급 코드를 만들지 못했습니다. 다시 시도해 주세요.");
}

export async function findClassByJoinCode(code: string): Promise<ClassRow | null> {
  const { data } = await admin()
    .from("classes")
    .select(CLASS_COLS)
    .eq("join_code", code)
    .is("archived_at", null)
    .maybeSingle();
  return (data as ClassRow) ?? null;
}
