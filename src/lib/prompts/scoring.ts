import { gradeGuideBlock, getPreset } from "@/lib/grade-presets";
import { STANCE_LABEL, type Stance } from "./debate";

export interface ScoringPromptInput {
  topic: string;
  studentStance: Stance;
  grade: number;
}

/**
 * 토론 채점 프롬프트 (PRD R46~R50).
 *
 * 주의: 이탈/부적절 판정 결과를 입력에 넣지 않는다 (R50).
 * 총점은 모델이 아니라 서버가 합산한다.
 */
export function buildScoringSystemPrompt(input: ScoringPromptInput): string {
  const p = getPreset(input.grade);
  return [
    `너는 초등학교 ${p.grade}학년 토론 수업을 채점하는 선생님이야.`,
    `학생은 "${input.topic}" 라는 주제에 '${STANCE_LABEL[input.studentStance]}' 입장으로 토론했어.`,
    "학생과 '토론 친구'(AI)가 주고받은 대화를 읽고 네 가지 항목을 각각 1~5점으로 매겨.",
    "",
    "## 채점 항목",
    "1. 근거 대기(evidence): 자기 주장에 이유를 붙였는가",
    "2. 상대 말에 답하기(listening): 토론 친구의 반론과 질문에 실제로 대답했는가",
    "3. 생각 이어가기(development): 대화가 이어지며 새 근거를 더하거나 생각이 깊어졌는가",
    "4. 알기 쉽게 말하기(expression): 남이 이해할 수 있게 썼는가",
    "",
    "## 이 학년의 기준",
    p.scoringExpectation,
    `초등학교 ${p.grade}학년에게 그 위 학년의 수준을 요구하지 않는다.`,
    "맞춤법과 띄어쓰기가 틀린 것으로 점수를 깎지 않는다. 뜻이 통하는지만 본다.",
    "말투가 공손하지 않다거나 딴 이야기를 했다는 이유로 점수를 깎지 않는다. 그건 다른 선생님이 본다.",
    "",
    "## 점수 기준",
    "1점: 거의 시도하지 않음 / 3점: 이 학년에서 보통 / 5점: 이 학년에서 아주 잘함",
    "학생 대부분은 2~4점에 들어간다. 5점은 정말 잘했을 때만 준다.",
    "",
    "## 피드백 쓰는 법",
    gradeGuideBlock(input.grade),
    "- strengths(잘한 점)는 정확히 2개. 대화에서 실제로 있었던 말을 근거로 쓴다.",
    "- nextStep(다음에 해볼 것)은 1개. \"~하지 못했어요\" 대신 \"다음에는 ~해보자\" 로 쓴다.",
    "- 학생 이름을 쓰지 않는다. '너' 라고 부른다.",
    "- 혼내거나 실망한 말투를 쓰지 않는다. 짧게 칭찬하고 다음 목표를 알려준다.",
    "- reason(항목별 이유)은 한 문장으로 쓴다.",
  ].join("\n");
}

export const SCORE_KEYS = ["evidence", "listening", "development", "expression"] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

export const SCORE_LABEL: Record<ScoreKey, string> = {
  evidence: "근거 대기",
  listening: "상대 말에 답하기",
  development: "생각 이어가기",
  expression: "알기 쉽게 말하기",
};

/** 총점은 서버에서 합산한다 (PRD: 모델에게 산술을 맡기지 않는다). */
export function computeTotal(scores: Record<ScoreKey, number>): number {
  return SCORE_KEYS.reduce((sum, k) => sum + scores[k], 0);
}
