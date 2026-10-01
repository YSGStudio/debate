import { describe, expect, it } from "vitest";
import { buildDebateSystemPrompt, buildOpeningPrompt, stanceWithClaim } from "@/lib/prompts/debate";
import { buildScoringSystemPrompt } from "@/lib/prompts/scoring";
import { buildStanceClaimsPrompt } from "@/lib/prompts/stance-claims";

// 부정형 주제: "찬성" 을 "숙제 찬성" 으로 거꾸로 읽기 쉬운 경우
const claims = { proClaim: "숙제를 없애야 한다", conClaim: "숙제는 계속 있어야 한다" };
const base = { topic: "숙제는 없어져야 한다", description: null, grade: 4 } as const;

describe("찬반 주장 문장이 입장과 함께 전달된다", () => {
  it("토론 프롬프트: 학생·챗봇 입장에 각자의 주장이 붙는다", () => {
    const p = buildDebateSystemPrompt({ ...base, ...claims, studentStance: "con" });
    expect(p).toContain('학생의 입장: 반대 ("숙제는 계속 있어야 한다")');
    expect(p).toContain('너의 입장: 찬성 ("숙제를 없애야 한다")');
    expect(p).toContain("주제 문장을 보고 찬성·반대의 뜻을 따로 짐작하지 말고");
  });

  it("첫 인사 프롬프트에도 학생 주장이 붙는다", () => {
    const p = buildOpeningPrompt({ ...base, ...claims, studentStance: "pro" });
    expect(p).toContain('찬성 ("숙제를 없애야 한다")');
  });

  it("채점 프롬프트에도 학생 주장이 붙는다", () => {
    const p = buildScoringSystemPrompt({ topic: base.topic, grade: 4, ...claims, studentStance: "pro" });
    expect(p).toContain('학생의 입장: 찬성 ("숙제를 없애야 한다")');
  });

  it("주장이 없는 옛 세션은 예전처럼 라벨만 쓴다", () => {
    const p = buildDebateSystemPrompt({ ...base, studentStance: "pro" });
    expect(p).toContain("학생의 입장: 찬성\n");
    expect(p).toContain("너의 입장: 반대\n");
    expect(p).not.toContain("짐작하지 말고");
    expect(stanceWithClaim("con", { proClaim: null, conClaim: null })).toBe("반대");
  });

  it("분량 규칙은 여전히 맨 끝에 있다", () => {
    const p = buildDebateSystemPrompt({ ...base, ...claims, studentStance: "pro" });
    expect(p.indexOf("# 분량 규칙")).toBeGreaterThan(p.indexOf("## 입장"));
  });
});

describe("주장 초안 프롬프트", () => {
  it("주제와 보충 설명이 들어간다", () => {
    const p = buildStanceClaimsPrompt("숙제는 없어져야 한다", "주말 숙제만 이야기한다");
    expect(p).toContain("숙제는 없어져야 한다");
    expect(p).toContain("보충 설명: 주말 숙제만 이야기한다");
  });

  it("찬성은 주제 문장에 동의하는 쪽이라고 정의한다", () => {
    expect(buildStanceClaimsPrompt("x", null)).toContain("찬성은 주제 문장에 동의하는 쪽");
  });
});
