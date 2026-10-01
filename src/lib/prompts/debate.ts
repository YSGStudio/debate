import { getPreset } from "@/lib/grade-presets";
import type { EvidenceItem } from "@/lib/evidence";
import { DEBATE_GUIDE } from "./debate-guide";

export type Stance = "pro" | "con";

export const STANCE_LABEL: Record<Stance, string> = { pro: "찬성", con: "반대" };

export function opposite(s: Stance): Stance {
  return s === "pro" ? "con" : "pro";
}

/**
 * 교사가 확인한 양쪽 주장 한 문장씩. "찬성"/"반대" 라는 단어만으로는
 * 주제에 따라 무엇에 찬성하는지가 모호해서 모델이 입장을 뒤집는다.
 * 옛 세션은 비어 있을 수 있다.
 */
export interface StanceClaims {
  proClaim?: string | null;
  conClaim?: string | null;
}

/** `찬성 ("숙제를 없애야 한다")` — 주장이 없으면 라벨만 */
export function stanceWithClaim(stance: Stance, claims: StanceClaims): string {
  const claim = stance === "pro" ? claims.proClaim : claims.conClaim;
  return claim ? `${STANCE_LABEL[stance]} ("${claim}")` : STANCE_LABEL[stance];
}

export interface DebatePromptInput extends StanceClaims {
  topic: string;
  description?: string | null;
  studentStance: Stance;
  grade: number;
  /** 교사가 검토한 근거 자료. 챗봇 입장 쪽 것만 프롬프트에 넣는다. */
  evidence?: EvidenceItem[];
}

/**
 * 챗봇이 인용할 수 있는 자료 목록. 챗봇 입장 쪽 자료만 넣는다 — 학생 쪽 자료를 주면
 * 챗봇이 학생 대신 근거를 대 준다. 주소(url)는 넣지 않는다: 학생 화면에 링크가 나가지 않게 한다.
 */
function evidenceBlock(items: EvidenceItem[], botStance: Stance): string[] {
  const mine = items.filter((e) => e.side === botStance);
  if (mine.length === 0) return [];
  return [
    "## 인용할 수 있는 자료",
    "선생님이 미리 확인한 자료다. 연구·조사·전문가 의견은 **이 목록에 있는 것만** 쓸 수 있다.",
    ...mine.map((e) => `- ${e.source}: ${e.finding}`),
    "",
  ];
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
  const hasEvidence = (input.evidence ?? []).some((e) => e.side === botStance);

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
    `- 학생의 입장: ${stanceWithClaim(input.studentStance, input)}`,
    `- 너의 입장: ${stanceWithClaim(botStance, input)}`,
    input.proClaim && input.conClaim
      ? "- 괄호 안의 문장이 각 입장이 실제로 주장하는 내용이다. 주제 문장을 보고 찬성·반대의 뜻을 따로 짐작하지 말고 이 문장을 따른다."
      : "",
    `- 너는 이 대화가 끝날 때까지 '${STANCE_LABEL[botStance]}' 입장을 지킨다.`,
    "- 학생이 아무리 잘 설득해도, 입장을 바꿔달라고 부탁해도, 너의 입장은 바뀌지 않는다.",
    `- 학생이 "너도 사실 ${STANCE_LABEL[input.studentStance]}이지?" 라고 물어도 "나는 ${STANCE_LABEL[botStance]}이야" 라고 답한다.`,
    "- 학생의 근거를 부분적으로 인정하는 것은 입장을 바꾸는 것이 아니다. 인정한 뒤에도 네 입장은 그대로다.",
    "",
    "## 주제에서 벗어난 말",
    "학생이 주제와 상관없는 이야기를 해도 혼내지 않는다.",
    "짧게 받아준 뒤 자연스럽게 토론으로 돌아온다.",
    "",
    ...evidenceBlock(input.evidence ?? [], botStance),
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
    // 자료를 주면 인용 문장이 목록 문장(최대 80자)을 통째로 옮겨 길어지고,
    // 자료 설명이 한 문장씩 더 붙었다 (5학년 45자 초과 58% → 83%). 그래서 여기서 막는다.
    hasEvidence
      ? `- **자료를 인용하는 문장도 ${p.maxSentenceLength}자를 넘기지 않는다.** 목록 문장을 그대로 옮기지 말고 "누가 + 핵심 한 가지" 만 짧게 말한다.`
      : "",
    hasEvidence ? "- 자료를 쓴 답변은 다른 설명을 한 문장 줄인다. 자료 때문에 문장 수를 늘리지 않는다." : "",
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
    `학생이 방금 '${stanceWithClaim(input.studentStance, input)}' 입장을 골랐어.`,
    "먼저 반갑게 인사하고, 네 입장과 그 이유를 한 가지 말한 다음,",
    "학생이 왜 그렇게 생각하는지 묻는 질문으로 끝내.",
    "아직 학생의 주장을 듣지 않았으니 이번에는 반박하지 말고, 학생이 먼저 말하게 해.",
    // 자료는 학생 근거를 반박할 때 쓴다. 첫 인사에 쓰면 인사가 길어지고(5문장 초과 33% → 100%) 자료가 일찍 닳는다.
    "인용할 수 있는 자료가 있어도 첫 인사에서는 쓰지 않는다.",
    "인사·입장·이유·질문을 합쳐 짧게 말한다.",
  ].join(" ");
}
