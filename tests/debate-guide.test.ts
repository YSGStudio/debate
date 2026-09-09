import { describe, expect, it } from "vitest";
import { DEBATE_GUIDE } from "@/lib/prompts/debate-guide";
import { buildDebateSystemPrompt, buildOpeningPrompt } from "@/lib/prompts/debate";
import { GRADE_PRESETS, GRADE_LEVELS } from "@/lib/grade-presets";

const base = { topic: "학교에서 스마트폰을 써도 된다", description: null, grade: 4 } as const;
const prompt = (stance: "pro" | "con" = "pro", grade = 4) =>
  buildDebateSystemPrompt({ ...base, studentStance: stance, grade });

describe("토론 지침이 프롬프트에 실린다", () => {
  it("지침 전체가 시스템 프롬프트에 들어간다", () => {
    expect(prompt()).toContain(DEBATE_GUIDE);
  });

  it("학생 뜻대로 흘러가지 않게 하라는 원칙이 있다", () => {
    const p = prompt();
    expect(p).toContain("학생의 의견대로 대화가 흘러가지 않게 한다");
    expect(p).toContain("같은 주장을 반복한다고 해서 그대로 인정하거나 토론을 끝내지 않는다");
  });

  it("근거를 검토하는 기준이 들어 있다", () => {
    const p = prompt();
    for (const k of [
      "주장과 근거가 실제로 연결되는가",
      "개인 경험 하나에만 기대고 있지는 않은가",
      "한두 사례를 모든 경우에 적용하고 있지는 않은가",
      "사실과 의견을 섞고 있지는 않은가",
      "예외 상황이 있지는 않은가",
    ]) {
      expect(p, `"${k}" 누락`).toContain(k);
    }
  });

  it("반론 관점 목록이 들어 있다", () => {
    const p = prompt();
    for (const k of ["공정성", "안전", "비용", "개인의 자유", "공동체의 이익", "예상 못 한 결과"]) {
      expect(p, `"${k}" 누락`).toContain(k);
    }
  });

  it("한 번에 반론 하나만 내라고 지시한다", () => {
    expect(prompt()).toContain("핵심 반론을 **하나만** 낸다");
    expect(prompt()).toContain("한 번에 여러 반론을 쏟아내지 않는다");
  });

  it("같은 반박을 반복하지 말고 새 관점으로 넘어가라고 한다", () => {
    const p = prompt();
    expect(p).toContain("같은 질문을 되풀이하지 않는다");
    expect(p).toContain("대화 기록을 보고 확인한 뒤, 새로운 관점으로 넘어간다");
  });

  it("근거 수준별 대응이 네 가지 다 있다", () => {
    const p = prompt();
    for (const k of ["근거가 없을 때", "근거가 약할 때", "근거가 적절할 때", "근거가 매우 탄탄할 때"]) {
      expect(p, `"${k}" 누락`).toContain(k);
    }
  });

  it("탄탄한 근거를 억지로 틀렸다고 하지 말라고 한다", () => {
    expect(prompt()).toContain("억지로 틀렸다고 하지 않는다");
  });

  it("AI 가 결론을 대신 내지 말라고 한다", () => {
    const p = prompt();
    expect(p).toContain("네가 대신 해결책이나 결론을 내놓지 않는다");
    expect(p).toContain("질문 뒤에 네 정답이나 결론을 덧붙이지 않는다");
  });

  it("금지 표현과 대체 표현이 들어 있다", () => {
    const p = prompt();
    expect(p).toContain('"틀렸어"');
    expect(p).toContain("그렇게 볼 수도 있지만 다른 상황도 생각해 볼 수 있어");
  });

  it("사실을 지어내지 말라고 한다 (R19)", () => {
    const p = prompt();
    expect(p).toContain("확실하지 않은 사실을 지어내지 않는다");
    expect(p).toContain("통계 숫자나 연구 결과, 출처를 만들어내지 않는다");
  });

  it("질문 수준을 6단계로 높이라고 한다", () => {
    expect(prompt()).toContain("질문의 수준 높이기");
    expect(prompt()).toContain("공정함과 편리함 중 하나를 골라야 한다면?");
  });
});

describe("지침과 학년 프리셋이 충돌하지 않는다", () => {
  it("분량이 충돌하면 학년 규칙이 이긴다고 명시한다", () => {
    expect(prompt()).toContain("분량이 충돌하면 아래가 이긴다");
  });

  it("분량 규칙이 프롬프트 맨 끝에 온다 (긴 지침에 묻히지 않게)", () => {
    const p = prompt();
    const idx = p.indexOf("# 분량 규칙");
    expect(idx).toBeGreaterThan(0);
    // 뒤쪽 15% 안에 있어야 한다
    expect(idx).toBeGreaterThan(p.length * 0.85);
  });

  it("학년마다 문장 수와 문장 길이를 못박는다", () => {
    for (const g of GRADE_LEVELS) {
      const preset = GRADE_PRESETS[g];
      const p = prompt("pro", g);
      expect(p).toContain(`한 번에 ${preset.sentenceRange[0]}~${preset.sentenceRange[1]}문장`);
      expect(p).toContain(`한 문장은 ${preset.maxSentenceLength}자를 넘기지 않는다`);
      expect(p).toContain(`초등학교 ${g}학년이다`);
    }
  });

  it("보내기 전 스스로 길이를 확인하라고 한다", () => {
    expect(prompt()).toContain("보내기 전에 스스로 확인한다");
    expect(prompt()).toContain("줄바꿈으로 길이를 숨기지 않는다");
  });
});

describe("입장 고정은 그대로 유지된다 (R17)", () => {
  it("학생이 찬성이면 챗봇은 반대다", () => {
    const p = prompt("pro");
    expect(p).toContain("학생의 입장: 찬성");
    expect(p).toContain("너의 입장: 반대");
  });

  it("부분 인정이 입장 변경이 아님을 못박는다", () => {
    expect(prompt()).toContain("부분적으로 인정하는 것은 입장을 바꾸는 것이 아니다");
  });
});

describe("첫 인사", () => {
  it("첫 턴에는 반박하지 말고 학생이 먼저 말하게 한다", () => {
    const p = buildOpeningPrompt({ ...base, studentStance: "pro" });
    expect(p).toContain("이번에는 반박하지 말고");
    expect(p).toContain("'찬성' 입장을 골랐어");
  });
});
