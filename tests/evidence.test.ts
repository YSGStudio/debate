import { describe, expect, it } from "vitest";
import { EVIDENCE_MAX, EVIDENCE_PER_SIDE, EvidenceListSchema, normalizeUrl, selectEvidence, type EvidenceItem } from "@/lib/evidence";
import { buildDebateSystemPrompt } from "@/lib/prompts/debate";
import { buildExtractPrompt, buildResearchPrompt } from "@/lib/prompts/evidence";

const A = "https://www.kci.go.kr/article/1?utm_source=openai";
const B = "https://www.who.int/news/item/2019";

describe("normalizeUrl", () => {
  it("검색 도구가 붙인 utm 파라미터와 끝 슬래시를 뗀다", () => {
    expect(normalizeUrl("https://a.org/x/?utm_source=openai")).toBe("https://a.org/x");
    expect(normalizeUrl("https://a.org/x?id=3&utm_source=openai#top")).toBe("https://a.org/x?id=3");
  });
});

describe("selectEvidence", () => {
  const raw = [
    { source: "한국교육개발원", finding: "숙제를 한 학생이 복습을 더 잘했다", url: A },
    { source: "지어낸 연구소", finding: "그럴듯한 내용", url: "https://made-up.example/paper" },
    { source: "세계보건기구", finding: "어린이 화면 시간은 짧을수록 좋다", url: B },
  ];

  it("실제로 인용된 주소의 자료만 남긴다 (지어낸 주소는 버린다)", () => {
    const out = selectEvidence(raw, "con", [A, B]);
    expect(out.map((i) => i.source)).toEqual(["한국교육개발원", "세계보건기구"]);
    expect(out.every((i) => i.side === "con")).toBe(true);
  });

  it("주소는 정리된 모양으로 저장한다", () => {
    expect(selectEvidence(raw, "pro", [A])[0].url).toBe("https://www.kci.go.kr/article/1");
  });

  it("\"더 찾기\" 때 이미 가진 주소는 다시 넣지 않는다", () => {
    const out = selectEvidence(raw, "con", [A, B], ["https://www.kci.go.kr/article/1"]);
    expect(out.map((i) => i.url)).toEqual([B]);
  });

  it("같은 주소가 두 번 나오면 하나만 남긴다", () => {
    const dup = [raw[0], { ...raw[0], finding: "같은 논문의 다른 문장" }];
    expect(selectEvidence(dup, "pro", [A])).toHaveLength(1);
  });

  it("형식이 틀린 항목은 버린다", () => {
    const bad = [{ source: "", finding: "x", url: A }, { source: "기관", finding: "x", url: "주소 아님" }, "문자열"];
    expect(selectEvidence(bad, "pro", [A, "주소 아님"])).toEqual([]);
  });

  it(`한쪽 최대 ${EVIDENCE_PER_SIDE.max}개에서 자른다`, () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ source: `기관${i}`, finding: "내용", url: `https://a.org/${i}` }));
    expect(selectEvidence(many, "pro", many.map((m) => m.url))).toHaveLength(EVIDENCE_PER_SIDE.max);
  });
});

describe("EvidenceListSchema", () => {
  it(`저장은 최대 ${EVIDENCE_MAX}개까지`, () => {
    const item: EvidenceItem = { side: "pro", source: "기관", finding: "내용", url: "https://a.org" };
    expect(EvidenceListSchema.safeParse(Array(EVIDENCE_MAX).fill(item)).success).toBe(true);
    expect(EvidenceListSchema.safeParse(Array(EVIDENCE_MAX + 1).fill(item)).success).toBe(false);
  });
});

describe("토론 프롬프트의 근거 자료", () => {
  const evidence: EvidenceItem[] = [
    { side: "pro", source: "찬성기관", finding: "숙제는 스트레스를 준다", url: "https://pro.example/1" },
    { side: "con", source: "반대기관", finding: "숙제는 복습에 도움이 된다", url: "https://con.example/1" },
  ];
  const base = {
    topic: "숙제는 없어져야 한다",
    proClaim: "숙제를 없애야 한다",
    conClaim: "숙제는 계속 있어야 한다",
    grade: 4,
    evidence,
  };

  it("챗봇 입장 쪽 자료만 넣는다 — 학생 쪽 자료를 주면 학생 대신 근거를 대 준다", () => {
    const p = buildDebateSystemPrompt({ ...base, studentStance: "pro" }); // 챗봇은 반대
    expect(p).toContain("반대기관: 숙제는 복습에 도움이 된다");
    expect(p).not.toContain("찬성기관");
  });

  it("주소는 넣지 않는다 — 학생 화면에 링크가 나가지 않게", () => {
    const p = buildDebateSystemPrompt({ ...base, studentStance: "con" });
    expect(p).toContain("찬성기관: 숙제는 스트레스를 준다");
    expect(p).not.toContain("https://");
  });

  it("자료 목록은 분량 규칙보다 앞에 있다 (분량 규칙은 맨 끝)", () => {
    const p = buildDebateSystemPrompt({ ...base, studentStance: "pro" });
    expect(p.indexOf("## 인용할 수 있는 자료")).toBeGreaterThan(0);
    expect(p.indexOf("# 분량 규칙")).toBeGreaterThan(p.indexOf("## 인용할 수 있는 자료"));
  });

  it("자료가 없으면 목록 절을 만들지 않는다", () => {
    const p = buildDebateSystemPrompt({ ...base, evidence: [], studentStance: "pro" });
    expect(p).not.toContain("## 인용할 수 있는 자료");
  });
});

describe("조사 프롬프트", () => {
  const input = { topic: "숙제는 없어져야 한다", description: null, claim: "숙제는 계속 있어야 한다" };

  it("뒷받침할 주장과 반대 자료 제외를 요청한다", () => {
    const p = buildResearchPrompt(input);
    expect(p).toContain('"숙제는 계속 있어야 한다" 라는 주장을 뒷받침하는');
    expect(p).toContain("반대 결론을 내는 자료는 빼");
  });

  it("\"더 찾기\" 때 이미 가진 자료를 빼 달라고 한다", () => {
    const p = buildResearchPrompt(input, ["OECD: 숙제 시간이 많을수록 과학 성적이 높다"]);
    expect(p).toContain("이미 있으니 빼고");
    expect(p).toContain("OECD: 숙제 시간이 많을수록 과학 성적이 높다");
  });

  it("정리 단계는 인용된 주소 목록 안에서만 고르게 한다", () => {
    const p = buildExtractPrompt({ ...input, grade: 4 }, "조사 글", [A]);
    expect(p).toContain(`- ${A}`);
    expect(p).toContain("목록에 없는 주소는 쓰지 않는다");
    expect(p).toContain("초등학교 4학년");
  });
});
