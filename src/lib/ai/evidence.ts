import "server-only";
import { z } from "zod";
import { generateObject, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/lib/env";
import { selectEvidence, type EvidenceItem } from "@/lib/evidence";
import { buildExtractPrompt, buildResearchPrompt } from "@/lib/prompts/evidence";

export interface ResearchInput {
  topic: string;
  description: string | null;
  proClaim: string;
  conClaim: string;
  grade: number;
  /** 어느 쪽 자료를 찾을지. 기본은 양쪽 */
  sides?: EvidenceItem["side"][];
  /** "더 찾기" 일 때 이미 가진 자료. 같은 주소는 다시 넣지 않고, 다른 자료를 찾게 한다. */
  existing?: EvidenceItem[];
}

const ExtractSchema = z.object({
  items: z.array(
    z.object({
      source: z.string().describe("기관이나 연구자 이름"),
      finding: z.string().describe("초등학생이 알아듣는 한 문장"),
      url: z.string().describe("인용된 주소 목록에서 고른 주소"),
    }),
  ),
});

/**
 * 찬성·반대 근거 자료를 웹 검색으로 모은다 (교사가 "근거 자료 찾기" / "더 찾기" 를 누를 때).
 *
 * 입장마다 두 단계:
 *   1. 조사 모델 + 웹 검색 — 출처를 인용하며 정리한 글을 받는다.
 *   2. 소형 모델 — 그 글을 항목으로 바꾼다. 주소는 1단계에서 실제로 인용된 것만 남긴다.
 * 마지막으로 서버가 주소를 열어 없는 페이지를 거른다. 교사가 저장 전에 읽고 지운다.
 *
 * 두 입장은 동시에 돈다. 한쪽이 실패해도 다른 쪽 결과는 돌려준다. 모두 실패하면 던진다.
 */
export async function researchEvidence(input: ResearchInput): Promise<EvidenceItem[]> {
  const openai = createOpenAI({ apiKey: env.openaiApiKey });
  const sides = input.sides ?? ["pro", "con"];
  const existing = input.existing ?? [];

  const search = async (side: EvidenceItem["side"]) => {
    const claim = side === "pro" ? input.proClaim : input.conClaim;
    const base = { topic: input.topic, description: input.description, claim };

    const researched = await generateText({
      model: openai(env.researchModel),
      tools: {
        web_search: openai.tools.webSearch({ userLocation: { type: "approximate", country: "KR" } }),
      },
      prompt: buildResearchPrompt(
        base,
        existing.filter((e) => e.side === side).map((e) => `${e.source}: ${e.finding}`),
      ),
      temperature: 0,
    });
    const cited = researched.sources.flatMap((s) => (s.sourceType === "url" ? [s.url] : []));
    if (cited.length === 0) return [];

    const { object } = await generateObject({
      model: openai(env.triageModel),
      schema: ExtractSchema,
      prompt: buildExtractPrompt({ ...base, grade: input.grade }, researched.text, cited),
      temperature: 0,
    });
    const items = selectEvidence(object.items, side, cited, existing.map((e) => e.url));
    return keepReachable(items);
  };

  const settled = await Promise.allSettled(sides.map(search));
  if (settled.every((s) => s.status === "rejected")) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }
  return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
}

const REACH_TIMEOUT_MS = 5000;

/**
 * 주소를 직접 열어 없는 페이지(404·410)를 거른다.
 * 로봇을 막는 사이트(403·429 등)와 느린 사이트(시간 초과)는 남긴다 — 교사가 링크를 눌러 확인한다.
 */
async function keepReachable(items: EvidenceItem[]): Promise<EvidenceItem[]> {
  const checks = await Promise.all(
    items.map(async (item) => {
      try {
        const res = await fetch(item.url, {
          redirect: "follow",
          signal: AbortSignal.timeout(REACH_TIMEOUT_MS),
          headers: { "user-agent": "Mozilla/5.0 (debate-classroom link check)" },
        });
        void res.body?.cancel();
        return res.status !== 404 && res.status !== 410;
      } catch (e) {
        return e instanceof Error && e.name === "TimeoutError";
      }
    }),
  );
  return items.filter((_, i) => checks[i]);
}
