/**
 * 채점 결과를 화면에 그릴 때 쓰는 값들.
 *
 * `prompts/scoring.ts` 는 프롬프트 본문(수천 자)을 들고 있어서 클라이언트가
 * 임포트하면 그 텍스트가 브라우저 번들에 그대로 실린다. 배점과 라벨만 필요한
 * 화면 코드는 이 파일을 쓴다. 배점의 단일 출처는 여기다 —
 * `prompts/scoring.ts` 도 여기서 다시 내보낸다.
 */

export const AREAS = [
  { key: "claim", label: "주장 표현", short: "주장", max: 15 },
  { key: "evidence", label: "근거의 적절성과 구체성", short: "근거", max: 25 },
  { key: "counter", label: "반론 이해와 대응", short: "반론 대응", max: 25 },
  { key: "development", label: "생각의 발전과 조정", short: "생각 발전", max: 25 },
  { key: "participation", label: "토론 참여와 답변 충실성", short: "참여", max: 10 },
] as const;

export type AreaKey = (typeof AREAS)[number]["key"];

export const AREA_KEYS = AREAS.map((a) => a.key) as readonly AreaKey[];
export const AREA_LABEL = Object.fromEntries(AREAS.map((a) => [a.key, a.label])) as Record<AreaKey, string>;
export const AREA_MAX = Object.fromEntries(AREAS.map((a) => [a.key, a.max])) as Record<AreaKey, number>;

export const BASE_TOTAL_MAX = AREAS.reduce((sum, a) => sum + a.max, 0); // 100
export const MAX_OFF_TOPIC_PENALTY = -15;

/** 토론 참여 분석 항목. 배열 앞쪽일수록 좋은 상태다. */
export const ANALYSIS_OPTIONS = {
  evidence: ["충분함", "보통", "부족함", "거의 없음"],
  counter: ["적극적", "보통", "부족함", "거의 없음"],
  shortAnswers: ["거의 없음", "일부 있음", "자주 있음", "대부분 단답"],
  focus: ["매우 좋음", "좋음", "일부 이탈", "반복적 이탈", "심각한 이탈"],
} as const;

export const ANALYSIS_LABEL = {
  evidence: "근거 제시",
  counter: "반론 대응",
  shortAnswers: "단답식 답변",
  focus: "주제 집중",
} as const;

export type AnalysisKey = keyof typeof ANALYSIS_OPTIONS;

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

export type Band = "good" | "ok" | "low" | "weak";

/** 득점률을 4단계로. 교사가 약한 영역을 한눈에 찾을 수 있어야 한다. */
export function band(value: number, max: number): Band {
  const r = max > 0 ? value / max : 0;
  if (r >= 0.8) return "good";
  if (r >= 0.6) return "ok";
  if (r >= 0.4) return "low";
  return "weak";
}

/** 분석 항목 값의 단계. 배열 앞쪽이 좋은 상태이므로 인덱스로 판단한다. */
export function analysisBand(key: AnalysisKey, value: string): Band {
  const i = (ANALYSIS_OPTIONS[key] as readonly string[]).indexOf(value);
  if (i <= 0) return "good";
  if (i === 1) return "ok";
  if (i === 2) return "low";
  return "weak";
}

export const BAND_TEXT: Record<Band, string> = {
  good: "text-emerald-700",
  ok: "text-blue-700",
  low: "text-amber-700",
  weak: "text-rose-700",
};

export const BAND_BAR: Record<Band, string> = {
  good: "bg-emerald-500",
  ok: "bg-blue-500",
  low: "bg-amber-500",
  weak: "bg-rose-500",
};

export const BAND_CHIP: Record<Band, string> = {
  good: "bg-emerald-50 text-emerald-800 border-emerald-200",
  ok: "bg-blue-50 text-blue-800 border-blue-200",
  low: "bg-amber-50 text-amber-800 border-amber-200",
  weak: "bg-rose-50 text-rose-800 border-rose-200",
};

/** 총점 배지 배경. 점수 카드 전체 색을 정한다. */
export const BAND_PANEL: Record<Band, string> = {
  good: "bg-emerald-600",
  ok: "bg-blue-600",
  low: "bg-amber-600",
  weak: "bg-rose-600",
};
