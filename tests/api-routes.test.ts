import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 라우트 핸들러의 판단 로직을 DB 대역으로 검증한다.
 * 실제 Supabase 연결 없이도 소유권·상한·상태 전이 규칙이 지켜지는지 확인한다.
 */

const state = {
  teacherId: null as string | null,
  inviteCode: { code: "OK2026", max_uses: 1, used_count: 0, is_active: true } as
    | { code: string; max_uses: number; used_count: number; is_active: boolean }
    | null,
  consumeSucceeds: true,
  classOwner: "teacher-a",
  singleActiveSession: true,
  openSessions: [] as { id: string; topic: string }[],
  sessionStatus: "draft" as "draft" | "open" | "closed",
  createdUsers: 0,
};

vi.mock("@/lib/session/teacher", () => ({
  getTeacherSession: async () => (state.teacherId ? { teacherId: state.teacherId } : null),
  setTeacherSession: async () => {},
  clearTeacherSession: async () => {},
}));

vi.mock("@/lib/db/teachers", () => ({
  findUsableInviteCode: async (code: string) => {
    const inv = state.inviteCode;
    if (!inv || inv.code !== code.toUpperCase()) return null;
    if (!inv.is_active) return null;
    if (inv.used_count >= inv.max_uses) return null;
    return inv;
  },
  consumeInviteCode: async (_c: string, seen: number) => {
    if (!state.consumeSucceeds) return false;
    if (!state.inviteCode || state.inviteCode.used_count !== seen) return false;
    state.inviteCode.used_count = seen + 1;
    return true;
  },
  createTeacherProfile: async () => {},
  getTeacher: async (id: string) => ({ id, email: "t@example.com", name: "선생" }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  admin: () => ({
    auth: {
      admin: {
        createUser: async () => {
          state.createdUsers++;
          return { data: { user: { id: "new-teacher" } }, error: null };
        },
        deleteUser: async () => {},
      },
    },
    from: () => ({
      update: () => ({ eq: async () => ({ data: [] }) }),
    }),
  }),
  anon: () => ({ auth: { signInWithPassword: async () => ({ data: { user: null }, error: null }) } }),
}));

vi.mock("@/lib/db/classes", () => ({
  getOwnedClass: async (teacherId: string, classId: string) =>
    teacherId === state.classOwner
      ? {
          id: classId,
          teacher_id: teacherId,
          name: "4학년 2반",
          grade_level: 4,
          join_code: "ABC234",
          single_active_session: state.singleActiveSession,
          created_at: "",
          archived_at: null,
        }
      : null,
}));

const session = () => ({
  id: "sess-1",
  class_id: "class-1",
  topic: "숙제는 없어져야 한다",
  description: null,
  grade_level: 4,
  status: state.sessionStatus,
  message_limit: 30,
  opened_at: null,
  closed_at: null,
  created_at: "",
});

vi.mock("@/lib/db/sessions", () => ({
  getOwnedSession: async (teacherId: string) =>
    teacherId === state.classOwner
      ? { session: session(), className: "4학년 2반", classId: "class-1" }
      : null,
  // 실제 DB 함수 open_session_atomic 의 판정 규칙을 그대로 흉내낸다.
  // (동시성 자체는 로컬 Postgres 에서 별도로 실증했다)
  openSessionAtomic: async () => {
    if (state.sessionStatus !== "draft") return { result: "not_draft", conflictTopic: null };
    if (state.singleActiveSession && state.openSessions.length > 0) {
      return { result: "conflict", conflictTopic: state.openSessions[0].topic };
    }
    state.sessionStatus = "open";
    return { result: "opened", conflictTopic: null };
  },
  closeSession: async () => ({ ...session(), status: "closed" as const }),
  updateDraftSession: async () => session(),
  getSession: async () => session(),
}));

vi.mock("@/lib/scoring-service", () => ({
  scoreWholeSession: async () => {},
  runScoring: async () => "done",
}));

const { POST: signup } = await import("@/app/api/teacher/signup/route");
const { PATCH: patchSession } = await import("@/app/api/sessions/[sessionId]/route");

function req(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ sessionId: "sess-1" }) };

beforeEach(() => {
  state.teacherId = "teacher-a";
  state.inviteCode = { code: "OK2026", max_uses: 1, used_count: 0, is_active: true };
  state.consumeSucceeds = true;
  state.classOwner = "teacher-a";
  state.singleActiveSession = true;
  state.openSessions = [];
  state.sessionStatus = "draft";
  state.createdUsers = 0;
});

describe("교사 가입 초대 코드 (R1, R2, AC1)", () => {
  const base = { email: "new@example.com", password: "password123", name: "새 선생" };

  it("올바른 코드면 계정이 만들어진다", async () => {
    const res = await signup(req({ ...base, inviteCode: "OK2026" }));
    expect(res.status).toBe(200);
    expect(state.createdUsers).toBe(1);
    expect(state.inviteCode!.used_count).toBe(1);
  });

  it("틀린 코드면 계정이 만들어지지 않는다 (AC1)", async () => {
    const res = await signup(req({ ...base, inviteCode: "WRONG" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("초대 코드가 올바르지 않습니다");
    expect(state.createdUsers).toBe(0);
  });

  it("max_uses 를 채운 코드로는 두 번째 가입이 거부된다 (AC1)", async () => {
    await signup(req({ ...base, inviteCode: "OK2026" }));
    const res = await signup(req({ ...base, email: "b@example.com", inviteCode: "OK2026" }));
    expect(res.status).toBe(403);
    expect(state.createdUsers).toBe(1);
  });

  it("비활성 코드는 거부된다", async () => {
    state.inviteCode!.is_active = false;
    expect((await signup(req({ ...base, inviteCode: "OK2026" }))).status).toBe(403);
  });

  it("비밀번호가 짧으면 거부된다", async () => {
    const res = await signup(req({ ...base, password: "short", inviteCode: "OK2026" }));
    expect(res.status).toBe(400);
    expect(state.createdUsers).toBe(0);
  });
});

describe("교사 소유권 (R4, AC2)", () => {
  it("로그인하지 않으면 401 이다", async () => {
    state.teacherId = null;
    expect((await patchSession(req({ action: "open" }), ctx)).status).toBe(401);
  });

  it("남의 세션이면 404 다 (AC2)", async () => {
    state.teacherId = "teacher-b";
    expect((await patchSession(req({ action: "open" }), ctx)).status).toBe(404);
  });
});

describe("단일 활성 세션 규칙 (R11, AC4)", () => {
  it("옵션이 켜져 있고 이미 열린 토론이 있으면 거부한다", async () => {
    state.openSessions = [{ id: "other", topic: "다른 토론" }];
    const res = await patchSession(req({ action: "open" }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("이미 열려 있는 토론이 있습니다");
    expect(body.openTopic).toBe("다른 토론");
  });

  it("옵션을 끄면 동시에 열 수 있다", async () => {
    state.singleActiveSession = false;
    state.openSessions = [{ id: "other", topic: "다른 토론" }];
    const res = await patchSession(req({ action: "open" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).session.status).toBe("open");
  });

  it("열린 토론이 없으면 옵션이 켜져 있어도 연다", async () => {
    expect((await patchSession(req({ action: "open" }), ctx)).status).toBe(200);
  });
});

describe("세션 상태 전이 (R10, AC10)", () => {
  it("끝난 토론은 다시 열 수 없다", async () => {
    state.sessionStatus = "closed";
    const res = await patchSession(req({ action: "open" }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("이미 끝난 토론");
  });

  it("열린 토론만 종료할 수 있다", async () => {
    state.sessionStatus = "draft";
    expect((await patchSession(req({ action: "close" }), ctx)).status).toBe(409);
  });

  it("열린 토론을 종료하면 closed 가 된다 (AC10)", async () => {
    state.sessionStatus = "open";
    const res = await patchSession(req({ action: "close" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).session.status).toBe("closed");
  });

  it("시작한 토론의 주제는 바꿀 수 없다 (R41)", async () => {
    state.sessionStatus = "open";
    const res = await patchSession(req({ action: "update", topic: "바꾼 주제" }), ctx);
    expect(res.status).toBe(409);
  });
});
