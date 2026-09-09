import { getPreset } from "@/lib/grade-presets";
import { SCORING_GUIDE } from "./scoring-guide";
import { STANCE_LABEL, type Stance } from "./debate";

export interface ScoringPromptInput {
  topic: string;
  studentStance: Stance;
  grade: number;
}

/** 5개 평가 영역과 배점. DB 제약(0004 마이그레이션)과 같은 값을 유지해야 한다. */
export const AREAS = [
  { key: "claim", label: "주장 표현", max: 15 },
  { key: "evidence", label: "근거의 적절성과 구체성", max: 25 },
  { key: "counter", label: "반론 이해와 대응", max: 25 },
  { key: "development", label: "생각의 발전과 조정", max: 25 },
  { key: "participation", label: "토론 참여와 답변 충실성", max: 10 },
] as const;

export type AreaKey = (typeof AREAS)[number]["key"];

export const AREA_KEYS = AREAS.map((a) => a.key) as readonly AreaKey[];
export const AREA_LABEL = Object.fromEntries(AREAS.map((a) => [a.key, a.label])) as Record<AreaKey, string>;
export const AREA_MAX = Object.fromEntries(AREAS.map((a) => [a.key, a.max])) as Record<AreaKey, number>;

export const BASE_TOTAL_MAX = AREAS.reduce((sum, a) => sum + a.max, 0); // 100
export const MAX_OFF_TOPIC_PENALTY = -15;

/** 토론 참여 분석 항목의 허용값 */
export const ANALYSIS_OPTIONS = {
  evidence: ["충분함", "보통", "부족함", "거의 없음"],
  counter: ["적극적", "보통", "부족함", "거의 없음"],
  shortAnswers: ["거의 없음", "일부 있음", "자주 있음", "대부분 단답"],
  focus: ["매우 좋음", "좋음", "일부 이탈", "반복적 이탈", "심각한 이탈"],
} as const;

/** 생각의 변화 선택지 */
export const CHANGE_OPTIONS = [
  "의견을 유지하면서 근거가 강화됨",
  "의견을 유지하면서 조건이 구체화됨",
  "의견의 일부를 수정함",
  "의견이 크게 바뀜",
  "새로운 관점을 고려했지만 큰 변화는 없음",
  "큰 변화 없이 기존 주장과 근거를 반복함",
  "근거가 부족하여 생각의 변화를 판단하기 어려움",
] as const;

/**
 * 토론 채점 프롬프트.
 *
 * 평가 기준은 `scoring-guide.ts` 가 정하고, 여기서는 이번 토론에만 해당하는 것
 * (주제, 학생 입장, 학년)을 붙인다.
 *
 * 주의: 이탈/부적절 **판정 결과(`moderation_flags`)를 입력에 넣지 않는다.**
 * 주제 이탈 감점은 평가자가 대화 자체를 읽고 판단한다. 판정기의 기준과
 * 평가 기준이 다르기 때문이다 (판정기는 넉넉하게 보고, 평가는 횟수와 영향을 따진다).
 *
 * 총점은 모델이 아니라 서버가 합산한다.
 */
export function buildScoringSystemPrompt(input: ScoringPromptInput): string {
  const p = getPreset(input.grade);

  return [
    SCORING_GUIDE,
    "",
    "# 이번 토론",
    "",
    `주제: ${input.topic}`,
    `학생의 입장: ${STANCE_LABEL[input.studentStance]}`,
    `학생의 학년: 초등학교 ${p.grade}학년`,
    "",
    "## 이 학년에서 기대할 수 있는 수준",
    p.scoringExpectation,
    `초등학교 ${p.grade}학년에게 그 위 학년의 수준을 요구하지 않는다.`,
    "",
    "## 피드백을 쓸 때의 말투",
    `- ${p.vocabularyGuide}`,
    `- 한 문장은 ${p.maxSentenceLength}자를 넘기지 않는다.`,
    '- "~하지 못했어요" 대신 "다음에는 ~해보자" 로 쓴다.',
  ].join("\n");
}

/**
 * 총점 계산 (PRD: 모델에게 산술을 맡기지 않는다).
 * 최종 점수는 0 미만으로 내려가지 않는다.
 */
export function computeTotals(
  scores: Record<AreaKey, number>,
  offTopicPenalty: number,
): { baseTotal: number; penalty: number; total: number } {
  const baseTotal = AREA_KEYS.reduce((sum, k) => sum + scores[k], 0);
  // 감점은 음수로 들어온다. 부호가 뒤집혀 오더라도 감점으로 취급한다.
  const penalty = Math.max(MAX_OFF_TOPIC_PENALTY, Math.min(0, -Math.abs(offTopicPenalty)));
  return { baseTotal, penalty, total: Math.max(0, baseTotal + penalty) };
}
