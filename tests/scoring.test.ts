import { describe, expect, it } from "vitest";
import {
  AREAS,
  AREA_KEYS,
  AREA_MAX,
  BASE_TOTAL_MAX,
  MAX_OFF_TOPIC_PENALTY,
  buildScoringSystemPrompt,
  computeTotals,
  type AreaKey,
} from "@/lib/prompts/scoring";
import { SCORING_GUIDE } from "@/lib/prompts/scoring-guide";
import { GRADE_LEVELS, GRADE_PRESETS } from "@/lib/grade-presets";

const full: Record<AreaKey, number> = {
  claim: 15, evidence: 25, counter: 25, development: 25, participation: 10,
};
const zero: Record<AreaKey, number> = {
  claim: 0, evidence: 0, counter: 0, development: 0, participation: 0,
};

describe("배점", () => {
  it("다섯 영역 합이 100점이다", () => {
    expect(BASE_TOTAL_MAX).toBe(100);
    expect(AREAS.map((a) => a.max)).toEqual([15, 25, 25, 25, 10]);
  });

  it("영역 키가 다섯 개다", () => {
    expect(AREA_KEYS).toEqual(["claim", "evidence", "counter", "development", "participation"]);
  });
});

describe("총점 계산 — 모델이 아니라 서버가 한다", () => {
  it("영역 점수를 합산한다", () => {
    const r = computeTotals({ claim: 12, evidence: 18, counter: 15, development: 16, participation: 8 }, 0);
    expect(r.baseTotal).toBe(69);
    expect(r.total).toBe(69);
  });

  it("만점은 100점이다", () => {
    expect(computeTotals(full, 0)).toMatchObject({ baseTotal: 100, total: 100 });
  });

  it("주제 이탈 감점을 뺀다", () => {
    const r = computeTotals(full, -5);
    expect(r.baseTotal).toBe(100);
    expect(r.penalty).toBe(-5);
    expect(r.total).toBe(95);
  });

  it("감점이 양수로 와도 감점으로 취급한다", () => {
    // 모델이 부호를 뒤집어 보내는 일이 있다. 점수가 올라가면 안 된다.
    expect(computeTotals(full, 8).total).toBe(92);
  });

  it("감점은 -15점을 넘지 않는다", () => {
    expect(computeTotals(full, -40).penalty).toBe(MAX_OFF_TOPIC_PENALTY);
    expect(computeTotals(full, -40).total).toBe(85);
  });

  it("최종 점수는 0점 미만으로 내려가지 않는다", () => {
    const r = computeTotals({ ...zero, claim: 2 }, -15);
    expect(r.baseTotal).toBe(2);
    expect(r.total).toBe(0);
  });

  it("모든 영역이 0이어도 계산된다", () => {
    expect(computeTotals(zero, 0)).toMatchObject({ baseTotal: 0, total: 0 });
  });
});

describe("채점 프롬프트", () => {
  const p = (grade = 4) =>
    buildScoringSystemPrompt({ topic: "숙제는 없어져야 한다", studentStance: "pro", grade });

  it("평가 기준 전체가 들어간다", () => {
    expect(p()).toContain(SCORING_GUIDE);
  });

  it("다섯 영역과 배점이 들어 있다", () => {
    for (const a of AREAS) {
      expect(p(), `"${a.label}" 누락`).toContain(a.label);
      expect(p()).toContain(`${a.max}점`);
    }
  });

  it("찬반에 따라 점수를 다르게 주지 말라고 한다", () => {
    expect(p()).toContain("찬성이냐 반대냐에 따라 점수를 다르게 주지 않는다");
  });

  it("의견 유지를 감점하지 않고 변경에 가산점을 주지 않는다고 한다", () => {
    expect(p()).toContain("처음 의견을 끝까지 유지했다고 감점하지 않는다");
    expect(p()).toContain("의견을 바꿨다고 자동으로 가산점을 주지 않는다");
  });

  it("AI 발언을 학생 능력으로 평가하지 말라고 한다", () => {
    expect(p()).toContain("AI 가 제시한 내용은 학생의 능력으로 평가하지 않는다");
    expect(p()).toContain("학생이 AI 의 말을 그대로 따라 한 부분은");
  });

  it("맞춤법을 핵심 요소로 삼지 말라고 한다", () => {
    expect(p()).toContain("맞춤법, 띄어쓰기, 문장 표현 능력은 핵심 평가 요소로 삼지 않는다");
  });

  it("단답 처리 규칙이 있다", () => {
    expect(p()).toContain("단답이라는 이유만으로 감점하지 않는다");
    expect(p()).toContain("안전하기 때문이야");
  });

  it("중복 감점 방지 규칙이 있다", () => {
    expect(p()).toContain("중복 감점 방지");
  });

  it("주제 이탈 감점 단계가 모두 있다", () => {
    for (const step of ["-2점", "-5점", "-8점", "-10점", "-15점"]) {
      expect(p(), `${step} 누락`).toContain(step);
    }
  });

  it("반론 회피와 주제 이탈을 구분하라고 한다", () => {
    expect(p()).toContain("반론 회피와 주제 이탈을 구분한다");
    expect(p()).toContain("감점하지 않는다.** 대신 반론 대응 점수를 낮춘다");
  });

  it("총점을 모델이 계산하지 말라고 한다", () => {
    expect(p()).toContain("총점은 계산하지 않는다");
  });

  it("학년별 기대 수준과 말투가 붙는다", () => {
    for (const g of GRADE_LEVELS) {
      const preset = GRADE_PRESETS[g];
      const prompt = p(g);
      expect(prompt).toContain(`초등학교 ${g}학년`);
      expect(prompt).toContain(preset.scoringExpectation);
      expect(prompt).toContain(`한 문장은 ${preset.maxSentenceLength}자를 넘기지 않는다`);
    }
  });

  it("판정 결과(moderation_flags)를 넘기지 않는다는 계약을 지킨다", () => {
    // 프롬프트에 판정 어휘가 섞이면 태도 평가가 이중으로 반영된다.
    const prompt = p();
    expect(prompt).not.toContain("moderation");
    expect(prompt).not.toContain("inappropriate");
  });
});

describe("영역별 상한", () => {
  it("각 영역의 상한이 배점과 같다", () => {
    expect(AREA_MAX).toEqual({
      claim: 15, evidence: 25, counter: 25, development: 25, participation: 10,
    });
  });
});
