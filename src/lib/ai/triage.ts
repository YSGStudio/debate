import "server-only";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import OpenAI from "openai";
import { env } from "@/lib/env";
import { buildTriageSystemPrompt } from "@/lib/prompts/triage";
import { COACH_FALLBACK, buildCoachRules, type CoachKind } from "@/lib/prompts/coach";

export type Verdict = "on_topic" | "off_topic" | "inappropriate";

export interface TriageResult {
  verdict: Verdict;
  reason: string | null;
  failed: boolean;
  /** 학생 화면에 실시간으로 띄울 길잡이 안내 */
  coachKind: CoachKind;
  coachMessage: string | null;
}

const TriageSchema = z.object({
  onTopic: z.boolean().describe("주제와 관련이 있으면 true"),
  reason: z.string().describe("판단 이유를 한 문장으로"),
  coachKind: z
    .enum(["praise", "need_reason", "off_topic", "none"])
    .describe("학생에게 보여줄 길잡이 안내의 종류"),
  coachMessage: z.string().describe("길잡이가 학생에게 할 한 문장. none 이면 빈 문자열"),
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

export interface TriageContext {
  topic: string;
  grade: number;
  /** 학생이 답한 직전 챗봇 발언. 반론에 제대로 답했는지 보려면 필요하다. */
  botPrevious?: string | null;
}

/** 주제 관련성 + 길잡이 안내 (소형 모델 한 번에) */
async function checkTopicAndCoach(ctx: TriageContext, text: string) {
  const openai = createOpenAI({ apiKey: env.openaiApiKey });
  const { object } = await generateObject({
    model: openai(env.triageModel),
    schema: TriageSchema,
    system: [buildTriageSystemPrompt(ctx.topic), "", buildCoachRules(ctx.grade)].join("\n"),
    prompt: [
      ctx.botPrevious ? `토론 친구가 방금 한 말: "${ctx.botPrevious}"` : "아직 토론 친구의 말이 없다.",
      `학생이 보낸 말: "${text}"`,
    ].join("\n"),
    temperature: 0,
  });
  return object;
}

/**
 * 학생 메시지 1건 판정 + 길잡이 안내 (PRD R24~R26).
 *
 * 부적절 판정이 관련성 판정보다 우선한다.
 * 실패해도 던지지 않고 on_topic + failed 로 돌려준다 — 판정 실패가 대화를 막으면 안 된다.
 */
export async function triageMessage(ctx: TriageContext, text: string): Promise<TriageResult> {
  try {
    const [mod, top] = await withTimeout(
      Promise.all([checkModeration(text), checkTopicAndCoach(ctx, text)]),
      TIMEOUT_MS,
    );

    if (mod.flagged) {
      // 부적절한 말에는 칭찬하지 않는다. 길잡이는 조용히 있고 교사가 다룬다.
      return {
        verdict: "inappropriate",
        reason: mod.reason,
        failed: false,
        coachKind: "none",
        coachMessage: null,
      };
    }

    // 관련성 판정과 코칭이 어긋나면 관련성 판정을 따른다 (점수 안내와 일치해야 한다).
    let coachKind = top.coachKind as CoachKind;
    if (!top.onTopic) coachKind = "off_topic";
    else if (coachKind === "off_topic") coachKind = "none";

    const coachMessage =
      coachKind === "none"
        ? null
        : top.coachMessage?.trim() || COACH_FALLBACK[coachKind];

    return {
      verdict: top.onTopic ? "on_topic" : "off_topic",
      reason: top.onTopic ? null : top.reason,
      failed: false,
      coachKind,
      coachMessage,
    };
  } catch (e) {
    // 판정 실패가 학생의 대화를 막아서는 안 된다 (R26).
    console.error("[triage] 판정 실패:", e instanceof Error ? e.message : e);
    return { verdict: "on_topic", reason: null, failed: true, coachKind: "none", coachMessage: null };
  }
}
