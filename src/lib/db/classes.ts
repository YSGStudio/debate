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

export interface ClassImpact {
  className: string;
  studentCount: number;
  sessionCount: number;
  openTopics: string[];
  messageCount: number;
  scoredCount: number;
}

/**
 * 학급을 지울 때 함께 사라지는 것을 센다.
 * 학급 → 학생 → 참여 → 메시지 순으로 전부 cascade 된다.
 */
export async function classDeletionImpact(classId: string, className: string): Promise<ClassImpact> {
  const [{ count: studentCount }, { data: sessions }] = await Promise.all([
    admin().from("students").select("id", { count: "exact", head: true }).eq("class_id", classId),
    admin().from("debate_sessions").select("id, topic, status").eq("class_id", classId),
  ]);

  const rows = (sessions ?? []) as { id: string; topic: string; status: string }[];
  const openTopics = rows.filter((s) => s.status === "open").map((s) => s.topic);

  if (rows.length === 0) {
    return {
      className,
      studentCount: studentCount ?? 0,
      sessionCount: 0,
      openTopics,
      messageCount: 0,
      scoredCount: 0,
    };
  }

  const { data: parts } = await admin()
    .from("participations")
    .select("id")
    .in("session_id", rows.map((s) => s.id));
  const ids = ((parts ?? []) as { id: string }[]).map((p) => p.id);

  let messageCount = 0;
  let scoredCount = 0;
  if (ids.length > 0) {
    const [m, sc] = await Promise.all([
      admin().from("messages").select("id", { count: "exact", head: true }).in("participation_id", ids),
      admin()
        .from("debate_scores")
        .select("id", { count: "exact", head: true })
        .in("participation_id", ids)
        .eq("status", "done"),
    ]);
    messageCount = m.count ?? 0;
    scoredCount = sc.count ?? 0;
  }

  return {
    className,
    studentCount: studentCount ?? 0,
    sessionCount: rows.length,
    openTopics,
    messageCount,
    scoredCount,
  };
}

/**
 * 학급 삭제. FK 가 cascade 이므로 학생·토론·대화·채점이 모두 사라진다.
 * 진행 중인 토론이 있으면 지우지 않는다 (호출부에서 먼저 확인한다).
 */
export async function deleteClass(teacherId: string, classId: string): Promise<boolean> {
  const { error } = await admin()
    .from("classes")
    .delete()
    .eq("id", classId)
    .eq("teacher_id", teacherId);
  return !error;
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
