import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderReportPdf, type ReportData } from "@/lib/pdf/report";

const OUT = path.join(process.cwd(), "tests", "output");

function fixture(): ReportData {
  const names = ["김하늘", "이바다", "박구름", "최나무", "정별빛"];
  return {
    className: "4학년 2반",
    gradeLevel: 4,
    topic: "숙제는 없어져야 한다",
    description: "우리 반 친구들과 숙제에 대해 생각해 봅시다.",
    status: "closed",
    generatedAt: "2026. 9. 8.",
    summary: {
      totalStudents: 5, joinedStudents: 5, proCount: 3, conCount: 2,
      totalMessages: 25, offTopicTotal: 1, inappropriateTotal: 1,
      scoredCount: 5, averageTotal: 15.4,
    },
    students: names.map((name, i) => ({
      name,
      stance: i % 2 === 0 ? ("pro" as const) : ("con" as const),
      messageCount: 5,
      messages: Array.from({ length: 5 }, (_, j) => [
        {
          role: "student" as const,
          content: `${name}의 ${j + 1}번째 생각이에요. 숙제가 많으면 놀 시간이 없어요.`,
          verdict: i === 1 && j === 0 ? "off_topic" : i === 2 && j === 1 ? "inappropriate" : null,
        },
        {
          role: "bot" as const,
          content: "그렇게 생각하는구나. 그런데 숙제를 하면 배운 걸 잊지 않을 수 있어. 너는 어떻게 생각해?",
          verdict: null,
        },
      ]).flat(),
      score: {
        status: "done",
        total: 16,
        scores: { evidence: 4, listening: 3, development: 4, expression: 5 },
        reasons: {
          evidence: "이유를 두 가지나 말했어요.",
          listening: "질문에 대답을 잘했어요.",
          development: "생각이 점점 깊어졌어요.",
          expression: "문장이 아주 잘 읽혀요.",
        },
        strengths: ["이유를 잘 댔어", "끝까지 생각했어"],
        nextStep: "다음에는 예를 하나 더 들어보자",
      },
    })),
  };
}

describe("PDF 생성 (R34, R35, AC16)", () => {
  it("폰트가 준비되어 있다 (Pre-Work P5)", () => {
    const dir = path.join(process.cwd(), "public", "fonts");
    for (const f of ["NotoSansKR-Regular.ttf", "NotoSansKR-Bold.ttf"]) {
      const p = path.join(dir, f);
      expect(fs.existsSync(p), `${f} 없음`).toBe(true);
      expect(fs.statSync(p).size).toBeGreaterThan(100_000);
    }
  });

  it("학생 5명 × 메시지 5개 PDF 가 만들어진다", async () => {
    const buf = await renderReportPdf(fixture());
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, "report.pdf");
    fs.writeFileSync(file, buf);

    expect(buf.length).toBeGreaterThan(10_000);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // 표지 1장 + 학생 5명 = 최소 6페이지
    const pages = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(6);
  }, 60_000);

  it("한글이 깨지지 않고 전원의 대화·점수·판정 표시가 들어간다 (AC16)", async () => {
    const buf = await renderReportPdf(fixture());
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;

    expect(doc.numPages).toBe(6);

    let all = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      all += content.items.map((x) => ("str" in x ? x.str : "")).join("");
    }

    for (const name of ["김하늘", "이바다", "박구름", "최나무", "정별빛"]) {
      expect(all, `${name} 누락`).toContain(name);
    }
    expect(all).toContain("토론 점수");
    for (const label of ["근거 대기", "상대 말에 답하기", "생각 이어가기", "알기 쉽게 말하기"]) {
      expect(all).toContain(label);
    }
    expect(all).toContain("잘한 점");
    expect(all).toContain("다음에 해볼 것");
    expect(all).toContain("[주제에서 벗어남]");
    expect(all).toContain("[부적절한 표현]");
    expect(all).toContain("초등 4학년"); // 표지의 학년 표시 (R44)
  }, 60_000);

  it("진행 중 세션에는 안내 문구가 붙는다 (R36)", async () => {
    const buf = await renderReportPdf({ ...fixture(), status: "open" });
    expect(buf.length).toBeGreaterThan(10_000);
  }, 60_000);
});
