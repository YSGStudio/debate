import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 챗봇 첫 인사 라우트 (R18).
 * 핵심 계약: **학생 메시지를 만들지 않는다** — 상한을 깎지 않고, 판정 대상이 되지 않고,
 * 채점 대화 전문에 학생 발언으로 섞이지 않는다.
 */

const state = {
  student: true,
  sessionStatus: "open" as "draft" | "open" | "closed",
  hasParticipation: true,
  existingMessages: 0,
  rateLimitOk: true,
};
const calls = {
  streamText: 0,
  appended: [] as { seq: number; role: string }[],
  bumped: 0,
  systemPrompt: "",
  userPrompt: "",
};

vi.mock("@/lib/session/student", () => ({
  getStudentSession: async () => (state.student ? { classId: "class-1", studentId: "stu-1" } : null),
}));

vi.mock("@/lib/db/students", () => ({
  getStudentInClass: async () =>
    state.student ? { id: "stu-1", class_id: "class-1", display_name: "김하늘", is_active: true } : null,
}));

vi.mock("@/lib/db/sessions", () => ({
  getSession: async () => ({
    id: "sess-1",
    class_id: "class-1",
    topic: "숙제는 없어져야 한다",
    description: null,
    grade_level: 3,
    status: state.sessionStatus,
    message_limit: 30,
    opened_at: null,
    closed_at: null,
    created_at: "",
  }),
}));

vi.mock("@/lib/db/participations", () => ({
  getParticipation: async () =>
    state.hasParticipation
      ? {
          id: "p1",
          session_id: "sess-1",
          student_id: "stu-1",
          stance: "pro" as const,
          student_message_count: 0,
          last_activity_at: null,
        }
      : null,
  listMessages: async () =>
    Array.from({ length: state.existingMessages }, (_, i) => ({
      id: `m${i}`,
      participation_id: "p1",
      seq: i + 1,
      role: "bot" as const,
      content: "이미 있는 말",
      created_at: "",
    })),
  appendMessage: async (_pid: string, seq: number, role: string, content: string) => {
    calls.appended.push({ seq, role });
    return { id: "m1", participation_id: "p1", seq, role, content, created_at: "" };
  },
  // 첫 인사 경로에서 이 함수가 불리면 계약 위반이다.
  bumpStudentMessageCount: async () => {
    calls.bumped++;
  },
}));

vi.mock("@/lib/db/rate-limit", () => ({
  takeMessageSlot: async () => state.rateLimitOk,
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => () => "model" }));
vi.mock("@/lib/env", () => ({ env: { openaiApiKey: "k", debateModel: "m" } }));

vi.mock("ai", () => ({
  streamText: (opts: { system: string; prompt: string; onEnd?: (e: { text: string }) => Promise<void> }) => {
    calls.streamText++;
    calls.systemPrompt = opts.system;
    calls.userPrompt = opts.prompt;
    return {
      toTextStreamResponse: () => {
        void opts.onEnd?.({ text: "안녕! 나는 반대야. 너는 왜 그렇게 생각해?" });
        return new Response("안녕! 나는 반대야. 너는 왜 그렇게 생각해?");
      },
    };
  },
}));

const { POST } = await import("@/app/api/debate/opening/route");

const req = () =>
  new Request("http://localhost/api/debate/opening", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "00000000-0000-4000-8000-000000000001" }),
  });

beforeEach(() => {
  state.student = true;
  state.sessionStatus = "open";
  state.hasParticipation = true;
  state.existingMessages = 0;
  state.rateLimitOk = true;
  calls.streamText = 0;
  calls.appended = [];
  calls.bumped = 0;
  calls.systemPrompt = "";
  calls.userPrompt = "";
});

describe("첫 인사 라우트 (R18)", () => {
  it("챗봇 응답을 bot 메시지 seq 1 로 저장한다", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    await res.text();
    await new Promise((r) => setTimeout(r, 10));

    expect(calls.appended).toEqual([{ seq: 1, role: "bot" }]);
  });

  it("학생 메시지를 만들지 않는다 — 상한을 깎지 않는다 (R21, R37)", async () => {
    const res = await POST(req());
    await res.text();
    await new Promise((r) => setTimeout(r, 10));

    expect(calls.bumped).toBe(0);
    expect(calls.appended.some((m) => m.role === "student")).toBe(false);
  });

  it("학년 프리셋과 반대 입장이 프롬프트에 들어간다 (R17, R43)", async () => {
    await POST(req());
    expect(calls.systemPrompt).toContain("초등학교 3학년");
    expect(calls.systemPrompt).toContain("학생의 입장: 찬성");
    expect(calls.systemPrompt).toContain("너의 입장: 반대");
    expect(calls.userPrompt).toContain("'찬성' 입장을 골랐어");
  });

  it("이미 대화가 시작됐으면 다시 만들지 않는다", async () => {
    state.existingMessages = 2;
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(calls.streamText).toBe(0);
  });

  it("짧은 간격의 중복 호출은 429 로 막는다", async () => {
    state.rateLimitOk = false;
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(calls.streamText).toBe(0);
  });

  it("입장하지 않은 학생은 401 이다", async () => {
    state.student = false;
    expect((await POST(req())).status).toBe(401);
  });

  it("찬반을 고르지 않았으면 409 다", async () => {
    state.hasParticipation = false;
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(calls.streamText).toBe(0);
  });

  it("열리지 않은 토론에서는 거부한다", async () => {
    state.sessionStatus = "closed";
    expect((await POST(req())).status).toBe(409);
    state.sessionStatus = "draft";
    expect((await POST(req())).status).toBe(409);
    expect(calls.streamText).toBe(0);
  });
});
