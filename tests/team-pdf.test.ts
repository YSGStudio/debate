import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderTeamReportPdf, type TeamPdfData } from "@/lib/pdf/team-report";
import type { Side, TeamPhase } from "@/lib/team/rules";

const OUT = path.join(process.cwd(), "tests", "output");

const NAMES = ["김하늘", "이바다", "박구름", "최나무", "정별빛", "한가람", "윤다온", "서나래", "임보라", "조은솔"];

/** 두 팀 10명 × 전체 토론방 발언 40개 (V-AC32) */
function fixture(): TeamPdfData {
  const phases: TeamPhase[] = ["claim", "rebuttal", "counter", "final"];
  const floor: TeamPdfData["floor"] = [];
  let seq = 0;
  for (let i = 0; i < 40; i++) {
    const side: Side = i % 2 === 0 ? "pro" : "con";
    const author = NAMES[(i % 5) + (side === "pro" ? 0 : 5)];
    floor.push({
      seq: ++seq,
      phase: phases[Math.floor(i / 10)],
      kind: "speech",
      side,
      author,
      content: `${author}의 발언 ${i + 1}: 급식이 맛있으면 음식을 남기지 않아요.`,
      hidden: i === 7,
      score: {
        status: i === 9 ? "failed" : "done",
        total: i === 9 ? null : 3,
        logic: 2, evidence: 1, response: 0, phaseFit: 1, attitude: -1,
        reason: "이유가 분명해요.",
        edited: i === 3,
      },
    });
    if (i === 12) floor.push({ seq: ++seq, phase: "rebuttal", kind: "pass", side: "con", author: null, content: "반대팀 패스", hidden: false, score: null });
  }
  return {
    className: "5학년 1반",
    gradeLevel: 5,
    topic: "급식은 맛있어야 한다",
    description: null,
    generatedAt: "2026. 9. 19.",
    teamNames: { pro: "찬성팀", con: "반대팀" },
    reportReady: true,
    totals: { pro: 57, con: 54, byStage: { claim: { pro: 15, con: 15 }, counter: { pro: 15, con: 12 } }, pendingCount: 0, failedCount: 1 },
    winner: "pro",
    feedback: {
      best: { pro: { point: "남기는 음식이 줄어든다", why: "경험을 들었어요." }, con: { point: "비용이 든다", why: "숫자를 들었어요." } },
      missed: ["영양 이야기를 아무도 하지 않았어요."],
      suggestions: ["다음엔 상대 근거를 한 번 더 짚어 보자."],
    },
    members: NAMES.map((name, i) => ({ name, side: i < 5 ? "pro" : "con", speechCount: 4, note: "끝까지 참여했어요." })),
    penalties: [{ side: "con", phase: "rebuttal", points: -1, reason: "연속 2회 패스" }],
    floor,
  };
}

describe("팀 토론 PDF (V-R45, V-AC32)", () => {
  it("10명 × 발언 40개 기록이 한글로 들어가고 숨김·패스·점수가 표시된다", async () => {
    const buf = await renderTeamReportPdf(fixture());
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "team-report.pdf"), buf);
    expect(buf.length).toBeGreaterThan(10_000);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
    let all = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      all += content.items.map((x) => ("str" in x ? x.str : "")).join("");
    }

    for (const name of NAMES) expect(all, `${name} 누락`).toContain(name);
    for (let i = 1; i <= 40; i++) expect(all, `발언 ${i} 누락`).toContain(`발언 ${i}:`);
    expect(all).toContain("숨김");
    expect(all).toContain("패스");
    expect(all).toContain("채점 대기");
    expect(all).toContain("선생님 수정");
    expect(all).toContain("찬성팀 우승");
    expect(all).toContain("초등 5학년");
    expect(all).toContain("연속 2회 패스");
    expect(all).not.toContain("팀 채팅");
  }, 60_000);

  it("결과 생성 전이면 표지에 표기한다", async () => {
    const buf = await renderTeamReportPdf({ ...fixture(), reportReady: false, feedback: null });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
    const first = await (await doc.getPage(1)).getTextContent();
    const text = first.items.map((x) => ("str" in x ? x.str : "")).join("");
    expect(text).toContain("결과 생성 전");
  }, 60_000);
});
