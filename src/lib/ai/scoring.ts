import "server-only";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/lib/env";
import {
  ANALYSIS_OPTIONS,
  AREA_KEYS,
  AREA_MAX,
  CHANGE_OPTIONS,
  buildScoringSystemPrompt,
  computeTotals,
  type AreaKey,
} from "@/lib/prompts/scoring";
import type { Stance } from "@/lib/prompts/debate";

const area = (max: number, label: string) =>
  z.object({
    score: z.number().int().min(0).max(max).describe(`${label} 점수 (0~${max})`),
    reason: z.string().describe("한 문장 평가"),
  });

const ScoreSchema = z.object({
  claim: area(AREA_MAX.claim, "주장 표현"),
  evidence: area(AREA_MAX.evidence, "근거의 적절성과 구체성"),
  counter: area(AREA_MAX.counter, "반론 이해와 대응"),
  development: area(AREA_MAX.development, "생각의 발전과 조정"),
  participation: area(AREA_MAX.participation, "토론 참여와 답변 충실성"),
  offTopicPenalty: z
    .number()
    .int()
    .min(-15)
    .max(0)
    .describe("주제 이탈 감점. 이탈이 없으면 0, 심하면 -15 까지"),
  offTopicReason: z.string().describe("감점 이유 한 문장. 감점이 0이면 주제에 집중했다고 쓴다"),
  strengths: z.array(z.string()).min(1).max(2).describe("잘한 점 1~2가지"),
  nextStep: z.string().describe("다음 토론에서 해볼 구체적인 방법"),
  analysis: z.object({
    evidence: z.enum(ANALYSIS_OPTIONS.evidence).describe("근거 제시"),
    counter: z.enum(ANALYSIS_OPTIONS.counter).describe("반론 대응"),
    shortAnswers: z.enum(ANALYSIS_OPTIONS.shortAnswers).describe("단답식 답변"),
    focus: z.enum(ANALYSIS_OPTIONS.focus).describe("주제 집중"),
  }),
  changeSummary: z.enum(CHANGE_OPTIONS).describe("생각의 변화"),
  changeReason: z.string().describe("그렇게 판단한 이유 한 문장"),
});

export interface ScoredResult {
  scores: Record<AreaKey, number>;
  reasons: Record<AreaKey, string>;
  baseTotal: number;
  offTopicPenalty: number;
  offTopicReason: string;
  total: number;
  strengths: string[];
  nextStep: string;
  analysis: { evidence: string; counter: string; shortAnswers: string; focus: string };
  changeSummary: string;
  changeReason: string;
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
    .map((m) => `${m.role === "student" ? "학생" : "토론 친구(AI)"}: ${m.content}`)
    .join("\n");
}

/**
 * 토론 채점.
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
    prompt:
      "아래는 학생과 토론 친구(AI)가 주고받은 대화 전문이야.\n" +
      "점수는 학생이 직접 쓴 발언만 보고 매겨.\n\n" +
      renderTranscript(input.transcript),
    temperature: 0.2,
  });

  const scores = Object.fromEntries(
    AREA_KEYS.map((k) => [k, object[k].score]),
  ) as Record<AreaKey, number>;
  const reasons = Object.fromEntries(
    AREA_KEYS.map((k) => [k, object[k].reason]),
  ) as Record<AreaKey, string>;

  const { baseTotal, penalty, total } = computeTotals(scores, object.offTopicPenalty);

  return {
    scores,
    reasons,
    baseTotal,
    offTopicPenalty: penalty,
    offTopicReason: object.offTopicReason,
    total,
    strengths: object.strengths,
    nextStep: object.nextStep,
    analysis: object.analysis,
    changeSummary: object.changeSummary,
    changeReason: object.changeReason,
    model,
  };
}
