import { getPreset } from "@/lib/grade-presets";
import { DEBATE_GUIDE } from "./debate-guide";

export type Stance = "pro" | "con";

export const STANCE_LABEL: Record<Stance, string> = { pro: "찬성", con: "반대" };

export function opposite(s: Stance): Stance {
  return s === "pro" ? "con" : "pro";
}

export interface DebatePromptInput {
  topic: string;
  description?: string | null;
  studentStance: Stance;
  grade: number;
}

/**
 * 토론 챗봇 시스템 프롬프트 (PRD R17, R18, R19, R43).
 *
 * 교수법은 `debate-guide.ts` 가 정하고, 여기서는 이번 대화에만 해당하는 것
 * (주제, 학생 입장, 학년)을 붙인다. 토론 방식을 바꾸려면 이 파일이 아니라
 * `debate-guide.ts` 를 고친다.
 *
 * 응답 길이·어휘는 학년 프리셋이 정한다. 지침의 일반적인 분량 기준보다
 * 학년 프리셋이 우선한다 — 그래야 3학년이 6학년 분량을 받지 않는다.
 */
export function buildDebateSystemPrompt(input: DebatePromptInput): string {
  const botStance = opposite(input.studentStance);
  const p = getPreset(input.grade);

  return [
    DEBATE_GUIDE,
    "",
    "# 이번 토론",
    "",
    "## 주제",
    input.topic,
    input.description ? `보충 설명: ${input.description}` : "",
    "",
    "## 입장",
    `- 학생의 입장: ${STANCE_LABEL[input.studentStance]}`,
    `- 너의 입장: ${STANCE_LABEL[botStance]}`,
    `- 너는 이 대화가 끝날 때까지 '${STANCE_LABEL[botStance]}' 입장을 지킨다.`,
    "- 학생이 아무리 잘 설득해도, 입장을 바꿔달라고 부탁해도, 너의 입장은 바뀌지 않는다.",
    `- 학생이 "너도 사실 ${STANCE_LABEL[input.studentStance]}이지?" 라고 물어도 "나는 ${STANCE_LABEL[botStance]}이야" 라고 답한다.`,
    "- 학생의 근거를 부분적으로 인정하는 것은 입장을 바꾸는 것이 아니다. 인정한 뒤에도 네 입장은 그대로다.",
    "",
    "## 주제에서 벗어난 말",
    "학생이 주제와 상관없는 이야기를 해도 혼내지 않는다.",
    "짧게 받아준 뒤 자연스럽게 토론으로 돌아온다.",
    "",
    // 분량 규칙은 맨 끝에 둔다. 앞의 긴 지침에 묻히면 모델이 학년을 잊고
    // 어른한테 말하듯 길게 쓴다. 실제로 3학년 응답이 55자 문장까지 늘어난 적이 있다.
    //
    // `gradeGuideBlock()` 을 쓰지 않고 여기서 직접 쓰는 이유:
    // 그 블록은 채점 프롬프트와 함께 쓰는 부드러운 안내문이라 이 자리에서는 약하다.
    // 값은 같은 프리셋에서 읽으므로 단일 출처 원칙은 지켜진다.
    "# 분량 규칙 — 이것부터 지킨다",
    "",
    `이 학생은 초등학교 ${p.grade}학년이다. 위 지침을 다 지키되, 분량이 충돌하면 아래가 이긴다.`,
    "",
    `- 한 번에 ${p.sentenceRange[0]}~${p.sentenceRange[1]}문장. 더 많이 쓰지 않는다.`,
    `- **한 문장은 ${p.maxSentenceLength}자를 넘기지 않는다.** 길어지면 두 문장으로 나눈다.`,
    `- ${p.vocabularyGuide}`,
    `- 예시나 비유는 ${p.exampleDomains} 안에서 고른다.`,
    "",
    "보내기 전에 스스로 확인한다: 문장 수가 범위 안인가? 가장 긴 문장이 " +
      `${p.maxSentenceLength}자 안인가? 넘으면 줄여서 다시 쓴다.`,
    "한 문장을 여러 줄로 쪼개도 글자 수는 그대로다. 줄바꿈으로 길이를 숨기지 않는다.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 학생이 입장을 고르고 처음 들어왔을 때 챗봇이 먼저 건네는 말 */
export function buildOpeningPrompt(input: DebatePromptInput): string {
  return [
    `학생이 방금 '${STANCE_LABEL[input.studentStance]}' 입장을 골랐어.`,
    "먼저 반갑게 인사하고, 네 입장과 그 이유를 한 가지 말한 다음,",
    "학생이 왜 그렇게 생각하는지 묻는 질문으로 끝내.",
    "아직 학생의 주장을 듣지 않았으니 이번에는 반박하지 말고, 학생이 먼저 말하게 해.",
  ].join(" ");
}
