import "server-only";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/lib/env";
import { ATTITUDE_MIN, JUDGE_MAX } from "@/lib/prompts/team-judge-guide";
import { buildJudgeSystemPrompt, buildJudgeUserPrompt, type JudgeSpeechInput } from "@/lib/prompts/team-judge";
import {
  buildReportSystemPrompt,
  buildReportUserPrompt,
  stripAliases,
  type TeamReportInput,
} from "@/lib/prompts/team-report";
import { normalizeParts, speechTotal, type SpeechParts, type Side } from "@/lib/team/rules";

const item = (max: number, label: string) =>
  z.number().int().min(0).max(max).describe(`${label} (0~${max})`);

const JudgeSchema = z.object({
  logic: item(JUDGE_MAX.logic, "논리성"),
  evidence: item(JUDGE_MAX.evidence, "근거의 구체성"),
  response: item(JUDGE_MAX.response, "상대 발언 반영"),
  phaseFit: item(JUDGE_MAX.phaseFit, "단계 적합성"),
  attitude: z.number().int().min(ATTITUDE_MIN).max(0).describe("태도 감점 (0 ~ -3). 문제없으면 0"),
  reason: z.string().describe("점수의 근거 한 문장"),
  respondedToSeq: z.number().int().nullable().describe("대응한 상대 팀 발언 번호. 없으면 null"),
});

const TIMEOUT_MS = 15000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("judge timeout")), ms)),
  ]);
}

export type JudgeResult =
  | {
      failed: false;
      parts: SpeechParts;
      total: number;
      reason: string;
      respondedToSeq: number | null;
      model: string;
    }
  | { failed: true; error: string };

/**
 * 발언 하나 채점 (V-R30, V-R31).
 *
 * **예외를 던지지 않는다.** 실패하면 `failed: true` 를 돌려준다 — 채점 실패가 발언 전송이나
 * 차례 이동을 막아서는 안 된다 (V-R35). `triageMessage` 와 같은 계약이다.
 * 테스트에서 이 함수를 throw 하도록 목킹하지 말 것 (존재하지 않는 경로가 된다).
 */
export async function judgeSpeech(input: JudgeSpeechInput): Promise<JudgeResult> {
  const model = env.judgeModel;
  try {
    const openai = createOpenAI({ apiKey: env.openaiApiKey });
    const { object } = await withTimeout(
      generateObject({
        model: openai(model),
        schema: JudgeSchema,
        system: buildJudgeSystemPrompt(input),
        prompt: buildJudgeUserPrompt(input),
        temperature: 0,
      }),
      TIMEOUT_MS,
    );
    const parts = normalizeParts(object);
    const validSeqs = new Set(input.history.map((h) => h.seq));
    return {
      failed: false,
      parts,
      total: speechTotal(parts),
      reason: object.reason.trim(),
      respondedToSeq:
        object.respondedToSeq !== null && validSeqs.has(object.respondedToSeq) ? object.respondedToSeq : null,
      model,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[team-judge] 채점 실패:", error);
    return { failed: true, error };
  }
}

const ReportSchema = z.object({
  best: z.object({
    pro: z.object({ point: z.string(), why: z.string() }),
    con: z.object({ point: z.string(), why: z.string() }),
  }),
  missed: z.array(z.string()).min(1).max(2),
  suggestions: z.array(z.string()).min(1).max(2),
  memberNotes: z.array(z.object({ alias: z.string(), note: z.string() })),
});

export interface TeamFeedbackResult {
  feedback: {
    best: Record<Side, { point: string; why: string }>;
    missed: string[];
    suggestions: string[];
  };
  /** 가명 → 잘한 점 (교사 전용). 서버가 member_id 로 바꿔 저장한다. */
  notesByAlias: Record<string, string>;
  model: string;
}

/**
 * 종합 피드백 (V-R41). 실패하면 던진다 — 호출부가 `failed` 로 저장하고 교사가 다시 만든다.
 */
export async function generateTeamFeedback(input: TeamReportInput): Promise<TeamFeedbackResult> {
  const model = env.scoringModel;
  const openai = createOpenAI({ apiKey: env.openaiApiKey });
  const { object } = await generateObject({
    model: openai(model),
    schema: ReportSchema,
    system: buildReportSystemPrompt(input.grade),
    prompt: buildReportUserPrompt(input),
    temperature: 0.3,
  });

  // 반 전체에 보이는 문장에 가명이 섞이면 팀 이름으로 바꾼다.
  const clean = (t: string) => stripAliases(t.trim(), input.teamNames);
  const aliases = new Set(input.members.map((m) => m.alias));

  return {
    feedback: {
      best: {
        pro: { point: clean(object.best.pro.point), why: clean(object.best.pro.why) },
        con: { point: clean(object.best.con.point), why: clean(object.best.con.why) },
      },
      missed: object.missed.map(clean),
      suggestions: object.suggestions.map(clean),
    },
    notesByAlias: Object.fromEntries(
      object.memberNotes.filter((n) => aliases.has(n.alias)).map((n) => [n.alias, n.note.trim()]),
    ),
    model,
  };
}
