import "server-only";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/lib/env";
import { buildStanceClaimsPrompt } from "@/lib/prompts/stance-claims";

const ClaimsSchema = z.object({
  proClaim: z.string().describe("찬성 쪽 주장 한 문장"),
  conClaim: z.string().describe("반대 쪽 주장 한 문장"),
});

/**
 * 찬성·반대 주장 초안 (교사 확인용).
 * 세션을 만들 때 교사가 버튼을 누를 때만 부르므로 소형 모델 한 번이다.
 * 실패하면 던진다 — 교사가 직접 쓰면 되므로 호출부가 안내만 한다.
 */
export async function suggestStanceClaims(
  topic: string,
  description: string | null,
): Promise<{ proClaim: string; conClaim: string }> {
  const openai = createOpenAI({ apiKey: env.openaiApiKey });
  const { object } = await generateObject({
    model: openai(env.triageModel),
    schema: ClaimsSchema,
    prompt: buildStanceClaimsPrompt(topic, description),
    temperature: 0,
  });
  return {
    proClaim: object.proClaim.trim().slice(0, 100),
    conClaim: object.conClaim.trim().slice(0, 100),
  };
}
