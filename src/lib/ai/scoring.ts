import "server-only";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/lib/env";
import { buildScoringSystemPrompt } from "@/lib/prompts/scoring";
import { computeTotal, SCORE_KEYS, type ScoreKey } from "@/lib/prompts/scoring";
import type { Stance } from "@/lib/prompts/debate";

const Item = z.object({
  score: z.number().int().min(1).max(5),
  reason: z.string(),
});

const ScoreSchema = z.object({
  evidence: Item,
  listening: Item,
  development: Item,
  expression: Item,
  strengths: z.array(z.string()).length(2).describe("잘한 점 2가지"),
  nextStep: z.string().describe("다음에 해볼 것 1가지"),
});

export interface ScoredResult {
  scores: Record<ScoreKey, number>;
  reasons: Record<ScoreKey, string>;
  strengths: string[];
  nextStep: string;
  total: number;
  model: string;
}

export interface ScoringInput {
  topic: string;
  studentStance: Stance;
  grade: number;
  transcript: { role: "student" | "bot"; content: string }[];
}

/** 채점에 필요한 최소 학생 메시지 수 (PRD R51) */
export const MIN_STUDENT_MESSAGES = 3;

export function countStudentMessages(transcript: ScoringInput["transcript"]): number {
  return transcript.filter((m) => m.role === "student").length;
}

function renderTranscript(transcript: ScoringInput["transcript"]): string {
  return transcript
    .map((m) => `${m.role === "student" ? "학생" : "토론 친구"}: ${m.content}`)
    .join("\n");
}

/**
 * 토론 채점 (PRD R46~R50).
 * 총점은 모델이 아니라 여기서 합산한다.
 */
export async function scoreDebate(input: ScoringInput): Promise<ScoredResult> {
  const openai = createOpenAI({ apiKey: env.openaiApiKey });
  const model = env.scoringModel;

  const { object } = await generateObject({
    model: openai(model),
    schema: ScoreSchema,
    system: buildScoringSystemPrompt({
      topic: input.topic,
      studentStance: input.studentStance,
      grade: input.grade,
    }),
    prompt: `아래는 학생과 토론 친구가 주고받은 대화 전문이야.\n\n${renderTranscript(input.transcript)}`,
    temperature: 0.2,
  });

  const scores = Object.fromEntries(
    SCORE_KEYS.map((k) => [k, object[k].score]),
  ) as Record<ScoreKey, number>;
  const reasons = Object.fromEntries(
    SCORE_KEYS.map((k) => [k, object[k].reason]),
  ) as Record<ScoreKey, string>;

  return {
    scores,
    reasons,
    strengths: object.strengths,
    nextStep: object.nextStep,
    total: computeTotal(scores),
    model,
  };
}
