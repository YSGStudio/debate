import { describe, expect, it } from "vitest";
import {
  GRADE_LEVELS,
  GRADE_PRESETS,
  DEFAULT_GRADE,
  getPreset,
  gradeGuideBlock,
  isGradeLevel,
} from "@/lib/grade-presets";
import { buildDebateSystemPrompt } from "@/lib/prompts/debate";
import { buildScoringSystemPrompt } from "@/lib/prompts/scoring";

describe("학년 프리셋 (R42, R48)", () => {
  it("3~6학년 프리셋이 모두 정의되어 있다", () => {
    expect(GRADE_LEVELS).toEqual([3, 4, 5, 6]);
    for (const g of GRADE_LEVELS) {
      const p = GRADE_PRESETS[g];
      expect(p.grade).toBe(g);
      expect(p.sentenceRange[0]).toBeGreaterThan(0);
      expect(p.sentenceRange[1]).toBeGreaterThanOrEqual(p.sentenceRange[0]);
      expect(p.maxSentenceLength).toBeGreaterThan(0);
      expect(p.vocabularyGuide.length).toBeGreaterThan(0);
      expect(p.scoringExpectation.length).toBeGreaterThan(0);
    }
  });

  it("기본 학년은 4학년이다 (AC19)", () => {
    expect(DEFAULT_GRADE).toBe(4);
  });

  it("학년이 올라갈수록 문장 수와 문장 길이 상한이 커진다", () => {
    for (let i = 1; i < GRADE_LEVELS.length; i++) {
      const lo = GRADE_PRESETS[GRADE_LEVELS[i - 1]];
      const hi = GRADE_PRESETS[GRADE_LEVELS[i]];
      expect(hi.maxSentenceLength).toBeGreaterThan(lo.maxSentenceLength);
      expect(hi.sentenceRange[1]).toBeGreaterThanOrEqual(lo.sentenceRange[1]);
    }
  });

  it("지원하지 않는 학년은 거부한다 (AC19)", () => {
    expect(() => getPreset(2)).toThrow();
    expect(() => getPreset(7)).toThrow();
    expect(isGradeLevel(4)).toBe(true);
    expect(isGradeLevel(2)).toBe(false);
    expect(isGradeLevel("4")).toBe(false);
  });

  it("토론 프롬프트에 그 학년의 문장 수·문장 길이 지침이 실제로 들어간다 (AC20)", () => {
    for (const g of GRADE_LEVELS) {
      const p = GRADE_PRESETS[g];
      const prompt = buildDebateSystemPrompt({
        topic: "숙제는 없어져야 한다",
        description: null,
        studentStance: "pro",
        grade: g,
      });
      expect(prompt).toContain(`초등학교 ${g}학년`);
      expect(prompt).toContain(`${p.maxSentenceLength}자`);
      expect(prompt).toContain(`${p.sentenceRange[0]}~${p.sentenceRange[1]}문장`);
      expect(prompt).toContain(p.vocabularyGuide);
    }
  });

  it("채점 프롬프트에도 같은 프리셋이 들어간다 (R48)", () => {
    for (const g of GRADE_LEVELS) {
      const p = GRADE_PRESETS[g];
      const prompt = buildScoringSystemPrompt({ topic: "t", studentStance: "con", grade: g });
      expect(prompt).toContain(p.scoringExpectation);
      expect(prompt).toContain(`${p.maxSentenceLength}자`);
    }
  });

  it("3학년과 6학년의 지침 블록이 실제로 다르다 (AC20)", () => {
    expect(gradeGuideBlock(3)).not.toBe(gradeGuideBlock(6));
  });
});

describe("토론 프롬프트 입장 고정 (R17)", () => {
  it("학생이 찬성이면 챗봇은 반대를 맡는다", () => {
    const p = buildDebateSystemPrompt({ topic: "t", description: null, studentStance: "pro", grade: 4 });
    expect(p).toContain("학생의 입장: 찬성");
    expect(p).toContain("너의 입장: 반대");
    expect(p).toContain("'반대' 입장을 지킨다");
  });

  it("학생이 반대면 챗봇은 찬성을 맡는다", () => {
    const p = buildDebateSystemPrompt({ topic: "t", description: null, studentStance: "con", grade: 4 });
    expect(p).toContain("학생의 입장: 반대");
    expect(p).toContain("너의 입장: 찬성");
  });

  it("되묻는 질문과 근거를 매번 요구한다 (R18)", () => {
    const p = buildDebateSystemPrompt({ topic: "t", description: null, studentStance: "pro", grade: 5 });
    expect(p).toContain("물음표로 끝나야 한다");
    expect(p).toContain("이유(근거)를 최소 한 가지");
  });

  it("출처를 지어내지 말라는 지침이 있다 (R19)", () => {
    const p = buildDebateSystemPrompt({ topic: "t", description: null, studentStance: "pro", grade: 6 });
    expect(p).toContain("지어내지 않는다");
  });
});
