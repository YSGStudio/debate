import { beforeEach, describe, expect, it, vi } from "vitest";

/** 학생 메시지 라우트의 게이트 로직 (R21, R22, R26, R37, R38) */

const state = {
  student: true,
  sessionStatus: "open" as "draft" | "open" | "closed",
  messageLimit: 3,
  messageCount: 0,
  hasParticipation: true,
  rateLimitOk: true,
  triageFails: false,
  verdict: "on_topic" as "on_topic" | "off_topic" | "inappropriate",
};
const calls = {
  streamText: 0, saveFlag: 0, triage: 0, scoring: 0,
  appended: [] as string[],
  savedFlags: [] as { verdict: string; failed: boolean; coachKind: string }[],
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
    grade_level: 4,
    status: state.sessionStatus,
    message_limit: state.messageLimit,
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
          student_message_count: state.messageCount,
          last_activity_at: null,
        }
      : null,
  listMessages: async () => [],
  nextSeq: async () => state.messageCount * 2 + 1,
  appendMessage: async (_pid: string, _seq: number, role: string, content: string) => {
    calls.appended.push(`${role}:${content}`);
    return { id: "m1", participation_id: "p1", seq: 1, role, content, created_at: "" };
  },
  bumpStudentMessageCount: async () => {},
}));

vi.mock("@/lib/db/flags", () => ({
  saveFlag: async (input: { verdict: string; triageFailed: boolean; coachKind: string }) => {
    calls.saveFlag++;
    calls.savedFlags.push({
      verdict: input.verdict,
      failed: input.triageFailed,
      coachKind: input.coachKind,
    });
  },
}));

vi.mock("@/lib/db/rate-limit", () => ({
  takeMessageSlot: async () => state.rateLimitOk,
}));

vi.mock("@/lib/ai/triage", () => ({
  // 실제 triageMessage 는 내부에서 예외를 삼키고 항상 결과를 돌려준다.
  // 판정이 실패한 경우의 실제 반환값(on_topic + failed:true)을 그대로 흉내낸다.
  triageMessage: async () => {
    calls.triage++;
    return state.triageFails
      ? { verdict: "on_topic", reason: null, failed: true, coachKind: "none", coachMessage: null }
      : {
          verdict: state.verdict,
          reason: "이유",
          failed: false,
          coachKind: state.verdict === "off_topic" ? "off_topic" : "praise",
          coachMessage: "안내 문구",
        };
  },
}));

vi.mock("@/lib/scoring-service", () => ({
  runScoring: async () => { calls.scoring++; return "done"; },
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => () => "model" }));
vi.mock("@/lib/env", () => ({ env: { openaiApiKey: "k", debateModel: "m" } }));

vi.mock("ai", () => ({
  streamText: (opts: { onEnd?: (e: { text: string }) => Promise<void> }) => {
    calls.streamText++;
    return {
      toTextStreamResponse: (init?: { headers?: Record<string, string> }) => {
        // 스트림이 끝나면 호출되는 콜백을 즉시 돌린다
        void opts.onEnd?.({ text: "그렇게 생각하는구나. 너는 왜 그렇게 생각해?" });
        return new Response("그렇게 생각하는구나. 너는 왜 그렇게 생각해?", { headers: init?.headers });
      },
    };
  },
}));

const { POST } = await import("@/app/api/debate/message/route");

function req(content: string) {
  return new Request("http://localhost/api/debate/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "00000000-0000-4000-8000-000000000001", content }),
  });
}

beforeEach(() => {
  state.student = true;
  state.sessionStatus = "open";
  state.messageLimit = 3;
  state.messageCount = 0;
  state.hasParticipation = true;
  state.rateLimitOk = true;
  state.triageFails = false;
  state.verdict = "on_topic";
  calls.streamText = 0;
  calls.saveFlag = 0;
  calls.triage = 0;
  calls.scoring = 0;
  calls.appended = [];
  calls.savedFlags = [];
});

describe("메시지 전송 게이트", () => {
  it("정상 전송은 스트리밍으로 응답한다 (AC8)", async () => {
    const res = await POST(req("숙제가 많으면 놀 시간이 없어요"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-message-count")).toBe("1");
    expect(res.headers.get("x-message-limit")).toBe("3");
    expect(calls.streamText).toBe(1);
    expect(calls.appended[0]).toContain("student:숙제가 많으면");
  });

  it("입장하지 않은 학생은 401 이다", async () => {
    state.student = false;
    expect((await POST(req("안녕"))).status).toBe(401);
  });

  it("찬반을 고르지 않았으면 거부한다 (R15)", async () => {
    state.hasParticipation = false;
    const res = await POST(req("안녕"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("찬성/반대를 골라주세요");
  });

  it("교사가 종료한 세션에는 보낼 수 없다 (AC10)", async () => {
    state.sessionStatus = "closed";
    const res = await POST(req("안녕"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.locked).toBe(true);
    expect(body.lockReason).toBe("closed");
    expect(calls.streamText).toBe(0);
  });

  it("메시지 상한에 도달하면 거부한다 (AC9)", async () => {
    state.messageCount = 3; // 상한 3에 도달
    const res = await POST(req("한 번 더"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.lockReason).toBe("limit");
    expect(calls.streamText).toBe(0);
  });

  it("상한 직전 메시지는 통과하고, 도달하면 채점이 시작된다 (AC9, AC22)", async () => {
    state.messageCount = 2; // 이번이 3번째 = 상한
    const res = await POST(req("마지막 생각이에요"));
    expect(res.status).toBe(200);
    await res.text();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.scoring).toBe(1);
  });

  it("상한에 닿지 않으면 채점하지 않는다", async () => {
    state.messageCount = 0;
    const res = await POST(req("첫 생각이에요"));
    await res.text();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.scoring).toBe(0);
  });

  it("5초 안에 다시 보내면 429 다 (AC17)", async () => {
    state.rateLimitOk = false;
    const res = await POST(req("빨리 또 보냄"));
    expect(res.status).toBe(429);
    expect(calls.streamText).toBe(0);
  });

  it("빈 메시지와 500자 초과는 거부한다 (R23)", async () => {
    expect((await POST(req("   "))).status).toBe(400);
    expect((await POST(req("가".repeat(501)))).status).toBe(400);
  });

  it("판정이 실패해도 챗봇 응답은 정상이다 (AC13)", async () => {
    state.triageFails = true;
    const res = await POST(req("숙제 이야기"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("그렇게 생각하는구나");
    expect(calls.streamText).toBe(1);
  });

  it("판정 실패는 triage_failed 로 기록된다 (AC13 후반)", async () => {
    state.triageFails = true;
    const res = await POST(req("숙제 이야기"));
    await res.text();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.savedFlags).toMatchObject([{ verdict: "on_topic", failed: true }]);
  });

  it("이탈 판정이 그대로 저장된다 (AC11)", async () => {
    state.verdict = "off_topic";
    const res = await POST(req("오늘 급식 뭐야?"));
    await res.text();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.savedFlags).toMatchObject([{ verdict: "off_topic", failed: false }]);
  });

  it("부적절 판정이 그대로 저장된다 (AC12)", async () => {
    state.verdict = "inappropriate";
    const res = await POST(req("<욕설 샘플>"));
    await res.text();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.savedFlags).toMatchObject([{ verdict: "inappropriate", failed: false }]);
  });

  it("판정은 스트리밍을 기다리지 않고 병렬로 돈다 (R27)", async () => {
    const res = await POST(req("숙제 이야기"));
    await res.text();
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.triage).toBe(1);
    expect(calls.saveFlag).toBe(1);
  });
});
