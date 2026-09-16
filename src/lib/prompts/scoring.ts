import { getPreset } from "@/lib/grade-presets";
import { AREA_KEYS, MAX_OFF_TOPIC_PENALTY, type AreaKey } from "@/lib/score-display";
import { SCORING_GUIDE } from "./scoring-guide";
import { STANCE_LABEL, type Stance } from "./debate";

export interface ScoringPromptInput {
  topic: string;
  studentStance: Stance;
  grade: number;
}

// 배점·라벨·선택지의 단일 출처는 `lib/score-display.ts` 다.
// 화면 코드가 이 파일(프롬프트 본문 수천 자)을 임포트하지 않도록 분리해 두었다.
export {
  AREAS,
  AREA_KEYS,
  AREA_LABEL,
  AREA_MAX,
  BASE_TOTAL_MAX,
  MAX_OFF_TOPIC_PENALTY,
  ANALYSIS_OPTIONS,
  CHANGE_OPTIONS,
  type AreaKey,
} from "@/lib/score-display";

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
