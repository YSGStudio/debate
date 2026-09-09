import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 학급·토론 삭제.
 *
 * 지우기 전에 무엇이 사라지는지 정확히 세는 것과,
 * 진행 중인 토론은 지우지 않는 것이 핵심이다.
 */

const state = {
  teacher: "teacher-a" as string | null,
  owner: "teacher-a",
  sessionStatus: "closed" as "draft" | "open" | "closed",
  sessions: [] as { id: string; topic: string; status: string }[],
  participationIds: [] as string[],
  messageCount: 0,
  scoredCount: 0,
  studentCount: 0,
  deleted: [] as string[],
};

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    requireTeacher: async () =>
      state.teacher ? { teacherId: state.teacher } : { response: actual.jsonError("로그인이 필요합니다.", 401) },
  };
});

/** 카운트 전용 supabase 대역 */
vi.mock("@/lib/supabase/admin", () => {
  function from(table: string) {
    const filters: Record<string, unknown> = {};
    let mode: "select" | "delete" = "select";
    let head = false;
    const api: Record<string, unknown> = {
      select(_c?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head) head = true;
        return api;
      },
      eq(col: string, val: unknown) { filters[col] = val; return api; },
      neq(col: string, val: unknown) { filters[`neq:${col}`] = val; return api; },
      in(col: string, vals: unknown[]) { filters[`in:${col}`] = vals; return api; },
      is() { return api; },
      order() { return api; },
      limit() { return api; },
      delete() { mode = "delete"; return api; },
      async maybeSingle() { return { data: null, error: null }; },
      then(res: (v: unknown) => void) {
        if (mode === "delete") {
          // 진행 중 토론은 지워지지 않아야 한다 (.neq("status","open"))
          if (table === "debate_sessions" && filters["neq:status"] === "open" && state.sessionStatus === "open") {
            return res({ data: [], error: null });
          }
          state.deleted.push(table);
          return res({ data: [], error: null });
        }
        if (table === "students") return res({ data: [], count: state.studentCount, error: null });
        if (table === "debate_sessions") return res({ data: state.sessions, count: state.sessions.length, error: null });
        if (table === "participations")
          return res({ data: state.participationIds.map((id) => ({ id })), count: state.participationIds.length, error: null });
        if (table === "messages") return res({ data: [], count: state.messageCount, error: null });
        if (table === "debate_scores") return res({ data: [], count: state.scoredCount, error: null });
        return res({ data: [], count: 0, error: null });
      },
    };
    void head;
    return api;
  }
  return { admin: () => ({ from }) };
});

const CLASS = {
  id: "class-1", teacher_id: "teacher-a", name: "4학년 2반", grade_level: 4,
  join_code: "123456", single_active_session: true, created_at: "", archived_at: null,
};

vi.mock("@/lib/db/classes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/classes")>();
  return {
    ...actual,
    getOwnedClass: async (teacherId: string) => (teacherId === state.owner ? CLASS : null),
    deleteClass: async () => { state.deleted.push("classes"); return true; },
  };
});

const SESSION = () => ({
  id: "sess-1", class_id: "class-1", topic: "숙제는 없어져야 한다", description: null,
  grade_level: 4, status: state.sessionStatus, message_limit: 30,
  opened_at: null, closed_at: null, created_at: "",
});

vi.mock("@/lib/db/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/sessions")>();
  return {
    ...actual,
    getOwnedSession: async (teacherId: string) =>
      teacherId === state.owner ? { session: SESSION(), className: "4학년 2반", classId: "class-1" } : null,
  };
});

vi.mock("@/lib/scoring-service", () => ({ scoreWholeSession: async () => {}, runScoring: async () => "done" }));

const { DELETE: deleteClassRoute } = await import("@/app/api/classes/[classId]/route");
const { DELETE: deleteSessionRoute } = await import("@/app/api/sessions/[sessionId]/route");

const classCtx = { params: Promise.resolve({ classId: "class-1" }) };
const sessCtx = { params: Promise.resolve({ sessionId: "sess-1" }) };
const req = (preview = false) =>
  new Request(`http://localhost/x${preview ? "?preview=1" : ""}`, { method: "DELETE" });

beforeEach(() => {
  state.teacher = "teacher-a";
  state.owner = "teacher-a";
  state.sessionStatus = "closed";
  state.sessions = [{ id: "sess-1", topic: "숙제는 없어져야 한다", status: "closed" }];
  state.participationIds = ["p1", "p2"];
  state.messageCount = 12;
  state.scoredCount = 2;
  state.studentCount = 25;
  state.deleted = [];
});

describe("학급 삭제", () => {
  it("미리보기는 지우지 않고 사라질 것만 알려준다", async () => {
    const res = await deleteClassRoute(req(true), classCtx);
    expect(res.status).toBe(200);
    const { impact } = await res.json();
    expect(impact).toMatchObject({
      className: "4학년 2반", studentCount: 25, sessionCount: 1, messageCount: 12, scoredCount: 2,
    });
    expect(state.deleted).toEqual([]);
  });

  it("확인 후에는 실제로 지운다", async () => {
    const res = await deleteClassRoute(req(), classCtx);
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);
    expect(state.deleted).toContain("classes");
  });

  it("진행 중인 토론이 있으면 거부한다", async () => {
    state.sessions = [{ id: "sess-1", topic: "진행 중 토론", status: "open" }];
    const res = await deleteClassRoute(req(), classCtx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("진행 중인 토론이 있습니다");
    expect(body.openTopics).toEqual(["진행 중 토론"]);
    expect(state.deleted).toEqual([]);
  });

  it("미리보기에도 진행 중 토론이 표시된다", async () => {
    state.sessions = [{ id: "sess-1", topic: "진행 중 토론", status: "open" }];
    const { impact } = await (await deleteClassRoute(req(true), classCtx)).json();
    expect(impact.openTopics).toEqual(["진행 중 토론"]);
  });

  it("남의 학급은 404 다 (R4)", async () => {
    state.teacher = "teacher-b";
    expect((await deleteClassRoute(req(), classCtx)).status).toBe(404);
    expect(state.deleted).toEqual([]);
  });

  it("로그인하지 않으면 401 이다", async () => {
    state.teacher = null;
    expect((await deleteClassRoute(req(), classCtx)).status).toBe(401);
  });

  it("빈 학급도 지울 수 있다", async () => {
    state.sessions = [];
    state.participationIds = [];
    state.messageCount = 0;
    state.scoredCount = 0;
    state.studentCount = 0;
    const { impact } = await (await deleteClassRoute(req(true), classCtx)).json();
    expect(impact).toMatchObject({ sessionCount: 0, messageCount: 0 });
    expect((await deleteClassRoute(req(), classCtx)).status).toBe(200);
  });
});

describe("토론 삭제", () => {
  it("미리보기는 지우지 않고 사라질 것만 알려준다", async () => {
    const res = await deleteSessionRoute(req(true), sessCtx);
    const { impact } = await res.json();
    expect(impact).toMatchObject({
      topic: "숙제는 없어져야 한다", joinedStudents: 2, messageCount: 12, scoredCount: 2,
    });
    expect(state.deleted).toEqual([]);
  });

  it("끝난 토론은 지운다", async () => {
    const res = await deleteSessionRoute(req(), sessCtx);
    expect(res.status).toBe(200);
    expect(state.deleted).toContain("debate_sessions");
  });

  it("준비 중(draft) 토론도 지운다", async () => {
    state.sessionStatus = "draft";
    expect((await deleteSessionRoute(req(), sessCtx)).status).toBe(200);
  });

  it("진행 중인 토론은 지우지 않는다", async () => {
    state.sessionStatus = "open";
    const res = await deleteSessionRoute(req(), sessCtx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("먼저 종료해 주세요");
    expect(state.deleted).toEqual([]);
  });

  it("남의 토론은 404 다 (R4)", async () => {
    state.teacher = "teacher-b";
    expect((await deleteSessionRoute(req(), sessCtx)).status).toBe(404);
    expect(state.deleted).toEqual([]);
  });
});
