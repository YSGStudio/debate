/**
 * 팀 토론 발언 채점 프롬프트 (ver2 PRD V-R30~V-R33).
 *
 * - 학생 이름은 넣지 않는다. 입력의 모든 학생은 가명("찬성팀 학생1")이다 (V-R32).
 * - Moderation 판정 결과를 넣지 않는다. 태도 감점은 심판이 발언을 읽고 판단한다 (V-R33).
 * - 합산은 서버가 한다 (`speechTotal`). 모델에게는 항목 점수만 받는다.
 * - 분량 규칙은 맨 끝에 둔다. 앞에 두면 모델이 학년을 잊는다 (debate.ts 와 같은 이유).
 */

import { getPreset } from "@/lib/grade-presets";
import { PHASE_GUIDE, PHASE_LABEL, type Side, type TeamPhase } from "@/lib/team/rules";
import { JUDGE_RUBRIC } from "./team-judge-guide";

export interface JudgeLine {
  seq: number;
  phase: TeamPhase;
  side: Side;
  /** 가명. 실명을 넣지 않는다. */
  alias: string;
  content: string;
}

export interface JudgeSpeechInput {
  topic: string;
  description: string | null;
  grade: number;
  teamNames: Record<Side, string>;
  /** 지금 채점하는 발언 */
  speech: JudgeLine;
  /** 이번 발언 이전의, 숨기지 않은 전체 토론방 발언 */
  history: JudgeLine[];
}

function sideLabel(side: Side, names: Record<Side, string>): string {
  return `${names[side]}(${side === "pro" ? "찬성" : "반대"})`;
}

export function renderLine(l: JudgeLine, names: Record<Side, string>): string {
  return `#${l.seq} [${PHASE_LABEL[l.phase]}] ${sideLabel(l.side, names)} ${l.alias}: ${l.content}`;
}

export function buildJudgeSystemPrompt(input: Pick<JudgeSpeechInput, "grade">): string {
  const p = getPreset(input.grade);
  return [
    "너는 초등학생 팀 대항 토론의 심판이다. 전체 토론방에 올라온 발언 **하나**를 기준표에 따라 채점한다.",
    "학생들은 서로 친구다. 점수와 근거는 선생님이 보고, 학생에게도 보일 수 있다.",
    "",
    JUDGE_RUBRIC,
    "",
    "# 이 학년의 기대 수준",
    `- 대상은 초등학교 ${p.grade}학년이다.`,
    `- ${p.teamJudgeExpectation}`,
    "- 중학생 수준의 논증을 요구하지 않는다.",
    "",
    "# 출력",
    "- 항목 점수만 낸다. 합계는 계산하지 않는다.",
    "- respondedToSeq: 이 발언이 대응한 상대 팀 발언의 번호(#숫자). 대응한 발언이 없으면 null.",
    "- 학생 이름이나 '학생1' 같은 호칭을 근거 문장에 쓰지 않는다. '이 발언은' 으로 시작해도 된다.",
    "",
    "# 분량 규칙 (반드시 지킨다)",
    `- reason 은 한 문장, ${p.maxSentenceLength}자 이내다.`,
    `- ${p.vocabularyGuide}`,
    "- 잘한 점이 있으면 먼저 말하고, 부족한 점은 '다음엔 ~하면 좋아요' 처럼 격려하는 말로 쓴다.",
  ].join("\n");
}

export function buildJudgeUserPrompt(input: JudgeSpeechInput): string {
  const names = input.teamNames;
  const history = input.history.length
    ? input.history.map((l) => renderLine(l, names)).join("\n")
    : "(아직 앞선 발언이 없다)";
  return [
    `토론 주제: ${input.topic}`,
    input.description ? `보충 설명: ${input.description}` : null,
    `찬성 팀 이름: ${names.pro} / 반대 팀 이름: ${names.con}`,
    "",
    "## 앞선 발언",
    history,
    "",
    "## 지금 채점할 발언",
    `단계: ${PHASE_LABEL[input.speech.phase]} — ${PHASE_GUIDE[input.speech.phase]}`,
    renderLine(input.speech, names),
  ]
    .filter((l) => l !== null)
    .join("\n");
}
