import { beforeEach, describe, expect, it, vi } from "vitest";

/** 인메모리 debate_scores 대역 */
const scores = new Map<string, { status: string; error?: string; attempts: number; payload?: unknown }>();
const calls = { scoreDebate: 0 };

vi.mock("@/lib/db/scores", () => ({
  claimScoring: async (pid: string) => {
    if (scores.has(pid)) return false; // unique 제약과 같은 역할
    scores.set(pid, { status: "pending", attempts: 1 });
    return true;
  },
  reclaimForRetry: async (pid: string) => {
    const cur = scores.get(pid);
    if (!cur || cur.status !== "failed") return false;
    scores.set(pid, { ...cur, status: "pending", attempts: cur.attempts + 1 });
    return true;
  },
  setSkipped: async (pid: string) => {
    scores.set(pid, { ...scores.get(pid)!, status: "skipped" });
  },
  setFailed: async (pid: string, msg: string) => {
    scores.set(pid, { ...scores.get(pid)!, status: "failed", error: msg });
  },
  setDone: async (pid: string, payload: unknown) => {
    scores.set(pid, { ...scores.get(pid)!, status: "done", payload });
  },
  getScore: async (pid: string) => scores.get(pid) ?? null,
}));

let transcript: { role: "student" | "bot"; content: string }[] = [];

vi.mock("@/lib/db/participations", () => ({
  getParticipationById: async (id: string) => ({
    id,
    session_id: "sess-1",
    student_id: "stu-1",
    stance: "pro" as const,
    student_message_count: transcript.filter((m) => m.role === "student").length,
    last_activity_at: null,
  }),
  listMessages: async () =>
    transcript.map((m, i) => ({
      id: `m${i}`,
      participation_id: "p1",
      seq: i + 1,
      role: m.role,
      content: m.content,
      created_at: new Date().toISOString(),
    })),
  listParticipations: async () => [
    { id: "p1", session_id: "sess-1", student_id: "s1", stance: "pro" as const, student_message_count: 5, last_activity_at: null },
    { id: "p2", session_id: "sess-1", student_id: "s2", stance: "con" as const, student_message_count: 5, last_activity_at: null },
  ],
}));

vi.mock("@/lib/db/sessions", () => ({
  getSession: async () => ({
    id: "sess-1",
    class_id: "c1",
    topic: "숙제는 없어져야 한다",
    description: null,
    grade_level: 4,
    status: "closed" as const,
    message_limit: 30,
    opened_at: null,
    closed_at: null,
    created_at: "",
  }),
}));

let shouldFail = false;

vi.mock("@/lib/ai/scoring", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/scoring")>();
  return {
    ...actual,
    scoreDebate: async () => {
      calls.scoreDebate++;
      if (shouldFail) throw new Error("모델 호출 실패");
      return {
        scores: { evidence: 4, listening: 3, development: 4, expression: 5 },
        reasons: { evidence: "r1", listening: "r2", development: "r3", expression: "r4" },
        strengths: ["이유를 잘 댔어", "끝까지 생각했어"],
        nextStep: "다음에는 예를 하나 더 들어보자",
        total: 16,
        model: "test-model",
      };
    },
  };
});

const { runScoring, scoreWholeSession } = await import("@/lib/scoring-service");

function makeTranscript(studentMessages: number) {
  const out: { role: "student" | "bot"; content: string }[] = [];
  for (let i = 0; i < studentMessages; i++) {
    out.push({ role: "student", content: `학생 발언 ${i + 1}` });
    out.push({ role: "bot", content: `토론 친구 응답 ${i + 1}` });
  }
  return out;
}

beforeEach(() => {
  scores.clear();
  calls.scoreDebate = 0;
  shouldFail = false;
  transcript = makeTranscript(5);
});

describe("채점 파이프라인", () => {
  it("정상 대화는 채점되고 총점이 저장된다 (AC22)", async () => {
    expect(await runScoring("p1")).toBe("done");
    const row = scores.get("p1")!;
    expect(row.status).toBe("done");
    expect((row.payload as { total: number }).total).toBe(16);
    expect(calls.scoreDebate).toBe(1);
  });

  it("학생 메시지가 3개 미만이면 모델을 부르지 않고 건너뛴다 (AC23)", async () => {
    transcript = makeTranscript(2);
    expect(await runScoring("p1")).toBe("skipped");
    expect(scores.get("p1")!.status).toBe("skipped");
    expect(calls.scoreDebate).toBe(0);
  });

  it("정확히 3개면 채점한다 (경계값)", async () => {
    transcript = makeTranscript(3);
    expect(await runScoring("p1")).toBe("done");
    expect(calls.scoreDebate).toBe(1);
  });

  it("채점에 실패하면 failed 로 남고 오류가 기록된다 (AC24)", async () => {
    shouldFail = true;
    expect(await runScoring("p1")).toBe("failed");
    expect(scores.get("p1")!.status).toBe("failed");
    expect(scores.get("p1")!.error).toContain("모델 호출 실패");
  });

  it("실패한 건만 다시 채점할 수 있다 (AC24)", async () => {
    shouldFail = true;
    await runScoring("p1");
    shouldFail = false;

    expect(await runScoring("p1", { retry: true })).toBe("done");
    expect(scores.get("p1")!.status).toBe("done");
    expect(scores.get("p1")!.attempts).toBe(2);
  });

  it("성공한 건은 다시 채점 요청을 받지 않는다", async () => {
    await runScoring("p1");
    expect(await runScoring("p1", { retry: true })).toBe("already");
    expect(calls.scoreDebate).toBe(1);
  });

  it("세션 종료와 상한 도달이 겹쳐도 모델 호출은 1회다 (AC25)", async () => {
    const [a, b] = await Promise.all([runScoring("p1"), runScoring("p1")]);
    expect([a, b].filter((r) => r === "done")).toHaveLength(1);
    expect([a, b].filter((r) => r === "already")).toHaveLength(1);
    expect(calls.scoreDebate).toBe(1);
  });

  it("세션 종료 시 전원이 한 번씩 채점된다 (AC22)", async () => {
    await scoreWholeSession("sess-1");
    expect(calls.scoreDebate).toBe(2);
    expect(scores.get("p1")!.status).toBe("done");
    expect(scores.get("p2")!.status).toBe("done");
  });

  it("이미 채점된 학생이 섞여 있어도 중복 호출하지 않는다 (AC25)", async () => {
    await runScoring("p1");
    calls.scoreDebate = 0;
    await scoreWholeSession("sess-1");
    expect(calls.scoreDebate).toBe(1); // p2 만
  });
});
