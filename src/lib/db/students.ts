import "server-only";
import { admin } from "@/lib/supabase/admin";
import { UNIQUE_VIOLATION, type StudentRow } from "./types";

const COLS = "id, class_id, display_name, is_active";

export async function listStudents(classId: string, activeOnly = false): Promise<StudentRow[]> {
  let q = admin().from("students").select(COLS).eq("class_id", classId);
  if (activeOnly) q = q.eq("is_active", true);
  const { data } = await q.order("display_name");
  return (data ?? []) as StudentRow[];
}

export interface BulkAddResult {
  ok: boolean;
  /** 이미 학급에 있는 이름들 (R6) */
  conflicts: string[];
  added: number;
}

/** 명단 일괄 등록. 하나라도 중복이면 아무것도 넣지 않는다 (R6) */
export async function bulkAddStudents(classId: string, names: string[]): Promise<BulkAddResult> {
  const existing = await listStudents(classId);
  const existingNames = new Set(existing.map((s) => s.display_name));
  const conflicts = names.filter((n) => existingNames.has(n));
  if (conflicts.length > 0) return { ok: false, conflicts, added: 0 };

  const { error } = await admin()
    .from("students")
    .insert(names.map((n) => ({ class_id: classId, display_name: n })));
  if (error) {
    // 조회와 삽입 사이에 다른 요청이 같은 이름을 넣은 경우
    if (error.code === UNIQUE_VIOLATION) {
      const after = await listStudents(classId);
      const afterNames = new Set(after.map((s) => s.display_name));
      return { ok: false, conflicts: names.filter((n) => afterNames.has(n)), added: 0 };
    }
    throw new Error(`명단 등록 실패: ${error.message}`);
  }
  return { ok: true, conflicts: [], added: names.length };
}

export async function addStudent(classId: string, name: string): Promise<StudentRow | null> {
  const { data, error } = await admin()
    .from("students")
    .insert({ class_id: classId, display_name: name })
    .select(COLS)
    .maybeSingle();
  if (error) return null;
  return (data as StudentRow) ?? null;
}

export async function renameStudent(classId: string, studentId: string, name: string): Promise<boolean> {
  const { error } = await admin()
    .from("students")
    .update({ display_name: name })
    .eq("id", studentId)
    .eq("class_id", classId);
  return !error;
}

/**
 * 삭제 (R7). 이미 메시지를 남긴 학생은 지우지 않고 비활성 처리한다.
 * 반환값은 실제로 한 일.
 */
export async function removeOrDeactivateStudent(
  classId: string,
  studentId: string,
): Promise<"deleted" | "deactivated" | "not_found"> {
  const { data: student } = await admin()
    .from("students")
    .select("id")
    .eq("id", studentId)
    .eq("class_id", classId)
    .maybeSingle();
  if (!student) return "not_found";

  // 이 학생의 **모든** 참여를 본다. 하나만 보고 판단하면 다른 세션의 기록이
  // cascade 로 함께 지워진다.
  const { data: parts } = await admin()
    .from("participations")
    .select("id")
    .eq("student_id", studentId);

  const participationIds = ((parts ?? []) as { id: string }[]).map((p) => p.id);

  let hasMessages = false;
  if (participationIds.length > 0) {
    const { count } = await admin()
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("participation_id", participationIds);
    hasMessages = (count ?? 0) > 0;
  }

  if (hasMessages) {
    await admin().from("students").update({ is_active: false }).eq("id", studentId);
    return "deactivated";
  }
  await admin().from("students").delete().eq("id", studentId);
  return "deleted";
}

export async function getStudentInClass(classId: string, studentId: string): Promise<StudentRow | null> {
  const { data } = await admin()
    .from("students")
    .select(COLS)
    .eq("id", studentId)
    .eq("class_id", classId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as StudentRow) ?? null;
}
