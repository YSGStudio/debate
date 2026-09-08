/**
 * 학년별 눈높이 프리셋 (PRD R42, R48).
 *
 * 이 파일이 학년 지침의 **단일 출처**다. 토론 프롬프트 빌더와 채점 프롬프트 빌더가
 * 모두 여기서 읽는다. 프리셋을 다른 곳에 복사해 두지 않는다.
 */

export const GRADE_LEVELS = [3, 4, 5, 6] as const;
export type GradeLevel = (typeof GRADE_LEVELS)[number];

export const DEFAULT_GRADE: GradeLevel = 4;

export interface GradePreset {
  grade: GradeLevel;
  /** 챗봇 한 응답의 문장 수 범위 */
  sentenceRange: [number, number];
  /** 한 문장의 최대 글자 수 */
  maxSentenceLength: number;
  /** 어휘·표현 지침 */
  vocabularyGuide: string;
  /** 비유와 예시를 끌어올 소재 범위 */
  exampleDomains: string;
  /** 이 학년에서 5점을 받을 만한 답변은 어떤 모습인가 (R48) */
  scoringExpectation: string;
}

export const GRADE_PRESETS: Record<GradeLevel, GradePreset> = {
  3: {
    grade: 3,
    sentenceRange: [2, 3],
    maxSentenceLength: 25,
    vocabularyGuide:
      "아주 쉬운 낱말만 쓴다. 한자어와 전문 용어를 쓰지 않는다. 한 문장에 생각을 하나만 담는다.",
    exampleDomains: "학교, 집, 놀이, 친구처럼 3학년이 매일 겪는 일",
    scoringExpectation:
      "3학년은 '왜냐하면 ~니까' 한 마디만 붙여도 근거를 댄 것으로 본다. 자기 경험을 이유로 드는 것도 훌륭한 근거다. 문장이 짧고 맞춤법이 틀려도 뜻이 통하면 표현 점수를 깎지 않는다.",
  },
  4: {
    grade: 4,
    sentenceRange: [3, 4],
    maxSentenceLength: 35,
    vocabularyGuide:
      "교과서에 나오는 수준의 낱말을 쓴다. 어려운 한자어는 쉬운 말로 바꿔 쓴다.",
    exampleDomains: "학교 생활, 가족, 동네, 좋아하는 것",
    scoringExpectation:
      "4학년은 주장에 이유를 붙이고, 상대가 물은 것에 대답하면 잘한 것이다. 이유가 두 개 이상이거나 예를 함께 들면 5점이다.",
  },
  5: {
    grade: 5,
    sentenceRange: [4, 5],
    maxSentenceLength: 45,
    vocabularyGuide:
      "'왜냐하면 ~ 때문이야' 같은 근거 구조를 또렷하게 쓴다. 낱말은 5학년 교과서 수준까지 허용한다.",
    exampleDomains: "학교, 지역 사회, 뉴스에서 본 일, 책에서 읽은 이야기",
    scoringExpectation:
      "5학년은 근거를 이유와 예시로 나눠 말할 수 있어야 5점이다. 상대 말의 어느 부분에 반대하는지 짚어서 답하면 '상대 말에 답하기'가 5점이다.",
  },
  6: {
    grade: 6,
    sentenceRange: [4, 6],
    maxSentenceLength: 55,
    vocabularyGuide:
      "조건과 반례를 쓸 수 있다. '항상 그런 건 아니야', '만약 ~라면' 같은 표현을 써도 된다. 그래도 어려운 전문 용어는 피한다.",
    exampleDomains: "학교, 사회 문제, 뉴스, 역사, 과학에서 배운 내용",
    scoringExpectation:
      "6학년은 자기 주장의 약점을 인정하거나 조건을 붙여 말할 수 있어야 5점이다. 상대 근거를 인용해 되받아치면 '상대 말에 답하기'가 5점이다.",
  },
};

export function getPreset(grade: number): GradePreset {
  const g = GRADE_PRESETS[grade as GradeLevel];
  if (!g) throw new Error(`지원하지 않는 학년입니다: ${grade} (3~6만 가능)`);
  return g;
}

export function isGradeLevel(v: unknown): v is GradeLevel {
  return typeof v === "number" && (GRADE_LEVELS as readonly number[]).includes(v);
}

/** 프롬프트에 그대로 끼워 넣는 학년 지침 블록. 토론·채점이 같은 문자열을 쓴다. */
export function gradeGuideBlock(grade: number): string {
  const p = getPreset(grade);
  return [
    `- 대화 상대는 초등학교 ${p.grade}학년(만 ${p.grade + 5}~${p.grade + 6}세)이다.`,
    `- 한 번에 ${p.sentenceRange[0]}~${p.sentenceRange[1]}문장으로 말한다.`,
    `- 한 문장은 ${p.maxSentenceLength}자를 넘기지 않는다.`,
    `- ${p.vocabularyGuide}`,
    `- 예시나 비유는 ${p.exampleDomains} 안에서 고른다.`,
  ].join("\n");
}
