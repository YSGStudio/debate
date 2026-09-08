import "server-only";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import OpenAI from "openai";
import { env } from "@/lib/env";
import { buildTriageSystemPrompt } from "@/lib/prompts/triage";

export type Verdict = "on_topic" | "off_topic" | "inappropriate";

export interface TriageResult {
  verdict: Verdict;
  reason: string | null;
  failed: boolean;
}

const TriageSchema = z.object({
  onTopic: z.boolean().describe("주제와 관련이 있으면 true"),
  reason: z.string().describe("판단 이유를 한 문장으로"),
});

const TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("triage timeout")), ms)),
  ]);
}

/** 부적절 여부 (OpenAI Moderation API, 무료) */
async function checkModeration(text: string): Promise<{ flagged: boolean; reason: string | null }> {
  const client = new OpenAI({ apiKey: env.openaiApiKey });
  const res = await client.moderations.create({
    model: "omni-moderation-latest",
    input: text,
  });
  const r = res.results[0];
  if (!r?.flagged) return { flagged: false, reason: null };
  const cats = Object.entries(r.categories)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  return { flagged: true, reason: cats.join(", ") || "부적절한 표현" };
}

/** 주제 관련성 (소형 모델) */
async function checkTopic(topic: string, text: string): Promise<{ onTopic: boolean; reason: string }> {
  const openai = createOpenAI({ apiKey: env.openaiApiKey });
  const { object } = await generateObject({
    model: openai(env.triageModel),
    schema: TriageSchema,
    system: buildTriageSystemPrompt(topic),
    prompt: `학생이 보낸 말: "${text}"`,
    temperature: 0,
  });
  return object;
}

/**
 * 학생 메시지 1건 판정 (PRD R24~R26).
 * 부적절 판정이 관련성 판정보다 우선한다. 실패해도 던지지 않고 on_topic + failed 로 돌려준다.
 */
export async function triageMessage(topic: string, text: string): Promise<TriageResult> {
  try {
    const [mod, top] = await withTimeout(
      Promise.all([checkModeration(text), checkTopic(topic, text)]),
      TIMEOUT_MS,
    );
    if (mod.flagged) return { verdict: "inappropriate", reason: mod.reason, failed: false };
    if (!top.onTopic) return { verdict: "off_topic", reason: top.reason, failed: false };
    return { verdict: "on_topic", reason: null, failed: false };
  } catch (e) {
    // 판정 실패가 학생의 대화를 막아서는 안 된다 (R26).
    console.error("[triage] 판정 실패:", e instanceof Error ? e.message : e);
    return { verdict: "on_topic", reason: null, failed: true };
  }
}
