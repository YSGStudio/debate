import { describe, expect, it, vi } from "vitest";

/** 학생 화면에는 다른 학생·반 평균이 새어 나가면 안 된다 (R53, AC26) */

vi.mock("@/lib/session/student", () => ({
  getStudentSession: async () => ({ classId: "class-1", studentId: "stu-1" }),
}));

vi.mock("@/lib/db/sessions", () => ({
  getSession: async () => ({
    id: "sess-1", class_id: "class-1", topic: "숙제는 없어져야 한다", description: null,
    grade_level: 4, status: "closed" as const, message_limit: 30,
    opened_at: null, closed_at: null, created_at: "",
  }),
  listOpenSessions: async () => [],
}));

vi.mock("@/lib/db/participations", () => ({
  getParticipation: async () => ({
    id: "p1", session_id: "sess-1", student_id: "stu-1", stance: "pro" as const,
    student_message_count: 5, last_activity_at: null,
  }),
  listMessages: async () => [],
}));

vi.mock("@/lib/db/scores", () => ({
  getScore: async () => ({
    id: "sc1", participation_id: "p1", status: "done" as const,
    score_evidence: 4, score_listening: 3, score_development: 4, score_expression: 5,
    total: 16,
    reasons: { evidence: "r1", listening: "r2", development: "r3", expression: "r4" },
    strengths: ["이유를 잘 댔어", "끝까지 생각했어"],
    next_step: "다음에는 예를 하나 더 들어보자",
    model: "m", attempts: 1, error: null,
  }),
}));

const { GET } = await import("@/app/api/debate/result/route");

describe("학생 결과 API (R53, AC26)", () => {
  it("본인 점수와 피드백을 돌려준다", async () => {
    const res = await GET(new Request("http://localhost/api/debate/result?sessionId=sess-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.score.total).toBe(16);
    expect(body.score.scores.evidence).toBe(4);
    expect(body.score.strengths).toHaveLength(2);
    expect(body.score.nextStep).toBeTruthy();
  });

  it("반 평균·순위·다른 학생 정보를 담지 않는다 (AC26)", async () => {
    const res = await GET(new Request("http://localhost/api/debate/result?sessionId=sess-1"));
    const raw = await res.text();
    for (const forbidden of ["average", "Average", "rank", "Rank", "classmate", "students", "평균", "등수"]) {
      expect(raw, `응답에 ${forbidden} 가 있으면 안 된다`).not.toContain(forbidden);
    }
    const body = JSON.parse(raw);
    expect(Object.keys(body).sort()).toEqual(["messageCount", "score", "stance", "topic"]);
  });
});
