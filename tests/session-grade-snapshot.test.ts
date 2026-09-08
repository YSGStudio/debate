import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 세션 학년 스냅샷 (R41, AC21) 과 학생 삭제/비활성 (R7).
 * 인메모리 DB 대역으로 실제 db 레이어 코드를 그대로 실행한다.
 */

interface Row {
  [k: string]: unknown;
}

const tables: Record<string, Row[]> = {
  classes: [],
  debate_sessions: [],
  students: [],
  participations: [],
  messages: [],
};

/** supabase-js 체인의 최소 구현 */
function makeClient() {
  function from(table: string) {
    const filters: [string, unknown][] = [];
    const inFilters: [string, unknown[]][] = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let countMode = false;

    const match = () =>
      tables[table].filter(
        (r) =>
          filters.every(([c, v]) => r[c] === v) &&
          inFilters.every(([c, vs]) => vs.includes(r[c])),
      );

    const api: Record<string, unknown> = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.count) countMode = true;
        if (mode === "insert") {
          const rows = Array.isArray(payload) ? payload : [payload!];
          tables[table].push(...rows);
          return {
            single: async () => ({ data: rows[0], error: null }),
            maybeSingle: async () => ({ data: rows[0], error: null }),
          };
        }
        if (mode === "update") {
          const hits = match();
          for (const r of hits) Object.assign(r, payload);
          return {
            single: async () => ({ data: hits[0] ?? null, error: null }),
            maybeSingle: async () => ({ data: hits[0] ?? null, error: null }),
            then: undefined,
          };
        }
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return api;
      },
      in(col: string, vals: unknown[]) {
        inFilters.push([col, vals]);
        return api;
      },
      is(col: string, val: unknown) {
        filters.push([col, val]);
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      insert(rows: Row | Row[]) {
        mode = "insert";
        payload = rows;
        const applied = Array.isArray(rows) ? rows : [rows];
        return {
          ...api,
          select: api.select,
          then: (res: (v: { error: null }) => void) => {
            tables[table].push(...applied);
            res({ error: null });
          },
        };
      },
      update(patch: Row) {
        mode = "update";
        payload = patch;
        return api;
      },
      delete() {
        mode = "delete";
        return api;
      },
      async maybeSingle() {
        const hits = match();
        return { data: hits[0] ?? null, error: null };
      },
      async single() {
        const hits = match();
        return { data: hits[0] ?? null, error: null };
      },
      then(res: (v: { data: Row[] | null; count?: number; error: null }) => void) {
        const hits = match();
        if (mode === "delete") {
          for (const r of hits) tables[table].splice(tables[table].indexOf(r), 1);
          return res({ data: hits, error: null });
        }
        if (mode === "update") {
          for (const r of hits) Object.assign(r, payload);
          return res({ data: hits, error: null });
        }
        return res({ data: hits, count: countMode ? hits.length : undefined, error: null });
      },
    };
    return api;
  }
  return { from };
}

vi.mock("@/lib/supabase/admin", () => ({ admin: () => makeClient() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, requireTeacher: async () => ({ teacherId: "t1" }) };
});

// 라우트가 쓰는 소유권 조회는 학년 5인 학급을 돌려준다.
vi.mock("@/lib/db/classes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/classes")>();
  return {
    ...actual,
    getOwnedClass: async () => ({
      id: "c1",
      teacher_id: "t1",
      name: "5학년 1반",
      grade_level: 5,
      join_code: "ABC234",
      single_active_session: true,
      created_at: "",
      archived_at: null,
    }),
  };
});

const { createSession } = await import("@/lib/db/sessions");
const { updateClass } = await import("@/lib/db/classes");
const { removeOrDeactivateStudent, bulkAddStudents } = await import("@/lib/db/students");

beforeEach(() => {
  for (const k of Object.keys(tables)) tables[k] = [];
  tables.classes.push({
    id: "c1",
    teacher_id: "t1",
    name: "4학년 2반",
    grade_level: 4,
    join_code: "ABC234",
    single_active_session: true,
    created_at: "",
    archived_at: null,
  });
});

describe("세션 학년 스냅샷 (R41, AC21)", () => {
  it("세션은 만들어질 때 학급 학년을 복사한다", async () => {
    const s = await createSession("c1", 4, "숙제는 없어져야 한다", null, 30);
    expect(s.grade_level).toBe(4);
  });

  it("학급 학년을 바꿔도 이미 만든 세션의 학년은 그대로다 (AC21)", async () => {
    await createSession("c1", 4, "토론 A", null, 30);

    const updated = await updateClass("t1", "c1", { grade_level: 5 });
    expect(updated?.grade_level).toBe(5);

    // 학급은 5학년이 됐지만 기존 세션은 4학년으로 남아야 한다
    expect(tables.debate_sessions[0].grade_level).toBe(4);
  });

  it("학년을 바꾼 뒤 새로 만든 세션에는 새 학년이 적용된다 (R40, R41)", async () => {
    await createSession("c1", 4, "토론 A", null, 30);
    await updateClass("t1", "c1", { grade_level: 6 });

    const cls = tables.classes[0] as { grade_level: number };
    const next = await createSession("c1", cls.grade_level, "토론 B", null, 30);

    expect(next.grade_level).toBe(6);
    expect(tables.debate_sessions[0].grade_level).toBe(4);
  });

  it("세션 생성 라우트가 요청 값이 아니라 학급 학년을 쓴다 (AC21 핵심)", async () => {
    // 라우트를 거쳐야 "학급 학년을 스냅샷한다"는 계약이 실제로 검증된다.
    const { POST } = await import("@/app/api/sessions/route");
    const res = await POST(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          classId: "00000000-0000-4000-8000-0000000000c1",
          topic: "라우트로 만든 토론",
          // 클라이언트가 학년을 보내더라도 무시되어야 한다
          gradeLevel: 3,
          grade_level: 3,
          messageLimit: 30,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.grade_level).toBe(5); // 학급 학년(아래 목에서 5)
  });
});

describe("학생 삭제와 비활성 (R7)", () => {
  beforeEach(() => {
    tables.students.push({ id: "s1", class_id: "c1", display_name: "김하늘", is_active: true });
  });

  it("기록이 없는 학생은 삭제된다", async () => {
    expect(await removeOrDeactivateStudent("c1", "s1")).toBe("deleted");
    expect(tables.students).toHaveLength(0);
  });

  it("메시지를 남긴 학생은 지우지 않고 비활성 처리한다", async () => {
    tables.participations.push({ id: "p1", student_id: "s1", session_id: "sess1" });
    tables.messages.push({ id: "m1", participation_id: "p1" });

    expect(await removeOrDeactivateStudent("c1", "s1")).toBe("deactivated");
    expect(tables.students).toHaveLength(1);
    expect(tables.students[0].is_active).toBe(false);
  });

  it("여러 세션 중 뒤쪽 세션에만 기록이 있어도 지우지 않는다 (데이터 소실 방지)", async () => {
    // 첫 참여에는 메시지가 없고, 두 번째 참여에만 있다.
    tables.participations.push(
      { id: "p1", student_id: "s1", session_id: "sess1" },
      { id: "p2", student_id: "s1", session_id: "sess2" },
    );
    tables.messages.push({ id: "m1", participation_id: "p2" });

    expect(await removeOrDeactivateStudent("c1", "s1")).toBe("deactivated");
    expect(tables.students[0].is_active).toBe(false);
    expect(tables.messages).toHaveLength(1);
  });

  it("다른 학급의 학생은 건드리지 않는다", async () => {
    expect(await removeOrDeactivateStudent("c-other", "s1")).toBe("not_found");
    expect(tables.students).toHaveLength(1);
  });
});

describe("명단 일괄 등록 (R6)", () => {
  beforeEach(() => {
    tables.students.push({ id: "s1", class_id: "c1", display_name: "김하늘", is_active: true });
  });

  it("이미 있는 이름이 있으면 아무것도 넣지 않고 충돌을 알려준다", async () => {
    const r = await bulkAddStudents("c1", ["김하늘", "이바다"]);
    expect(r.ok).toBe(false);
    expect(r.conflicts).toEqual(["김하늘"]);
    expect(r.added).toBe(0);
    expect(tables.students).toHaveLength(1); // 이바다도 들어가지 않았다
  });

  it("중복이 없으면 전부 등록한다", async () => {
    const r = await bulkAddStudents("c1", ["이바다", "박구름"]);
    expect(r.ok).toBe(true);
    expect(r.added).toBe(2);
    expect(tables.students).toHaveLength(3);
  });
});
