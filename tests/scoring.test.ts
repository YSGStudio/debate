import { describe, expect, it } from "vitest";
import { computeTotal, SCORE_KEYS, buildScoringSystemPrompt } from "@/lib/prompts/scoring";
import { countStudentMessages, MIN_STUDENT_MESSAGES } from "@/lib/ai/scoring";

describe("채점 총점 합산 (모델이 아니라 서버가 계산한다)", () => {
  it("4항목 합이 총점이다", () => {
    expect(computeTotal({ evidence: 4, listening: 3, development: 4, expression: 5 })).toBe(16);
    expect(computeTotal({ evidence: 1, listening: 1, development: 1, expression: 1 })).toBe(4);
    expect(computeTotal({ evidence: 5, listening: 5, development: 5, expression: 5 })).toBe(20);
  });

  it("항목은 정확히 4개다", () => {
    expect(SCORE_KEYS).toEqual(["evidence", "listening", "development", "expression"]);
  });
});

describe("채점 대상 판정 (R51)", () => {
  it("학생 메시지만 센다", () => {
    const t = [
      { role: "student" as const, content: "a" },
      { role: "bot" as const, content: "b" },
      { role: "student" as const, content: "c" },
    ];
    expect(countStudentMessages(t)).toBe(2);
  });

  it("기준은 3개다", () => {
    expect(MIN_STUDENT_MESSAGES).toBe(3);
  });
});

describe("채점 프롬프트 계약 (R50)", () => {
  it("이탈·부적절 판정 개념을 채점 기준에서 배제한다", () => {
    const p = buildScoringSystemPrompt({ topic: "숙제", studentStance: "pro", grade: 4 });
    expect(p).toContain("딴 이야기를 했다는 이유로 점수를 깎지 않는다");
    expect(p).toContain("맞춤법과 띄어쓰기가 틀린 것으로 점수를 깎지 않는다");
  });

  it("피드백 형식을 못박는다 (R47, R49)", () => {
    const p = buildScoringSystemPrompt({ topic: "숙제", studentStance: "pro", grade: 4 });
    expect(p).toContain("정확히 2개");
    expect(p).toContain("다음에는 ~해보자");
    expect(p).toContain("학생 이름을 쓰지 않는다");
  });
});
