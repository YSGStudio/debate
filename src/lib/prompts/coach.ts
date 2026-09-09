import { getPreset } from "@/lib/grade-presets";

/**
 * '길잡이' 캐릭터의 실시간 안내.
 *
 * 토론 챗봇은 지침상 주제 이탈을 혼내지 않고 대화를 이어간다.
 * 그 역할을 길잡이가 맡아 학생에게 무엇이 점수에 영향을 주는지 알려준다.
 *
 * 판정(triage)과 같은 모델 호출에서 함께 받는다. 별도 호출을 만들면
 * 학생 메시지마다 비용이 두 배가 된다.
 */

export const COACH_NAME = "길잡이";

export type CoachKind = "praise" | "need_reason" | "off_topic" | "none";

/** 모델이 실패했을 때 쓰는 기본 문구. 아이에게 보여줄 말이므로 비워두지 않는다. */
export const COACH_FALLBACK: Record<Exclude<CoachKind, "none">, string> = {
  praise: "좋은 의견이에요! 근거를 들어 잘 답했어요. 채점에 좋게 반영돼요.",
  need_reason: "왜 그렇게 생각하는지 이유를 조금만 더 써볼까요?",
  off_topic: "지금은 주제에서 벗어났어요. 토론 점수가 깎일 수 있어요. 주제로 돌아와 볼까요?",
};

export function buildCoachRules(grade: number): string {
  const p = getPreset(grade);
  return [
    `## 길잡이 안내 (${COACH_NAME})`,
    "",
    "학생 화면 옆에서 실시간으로 한 줄 안내를 해주는 역할이다.",
    "학생이 방금 보낸 말을 보고 아래 넷 중 하나를 고른다.",
    "",
    "- **praise**: 자기 주장에 이유나 근거를 붙였거나, 토론 친구가 던진 반론·질문에",
    "  근거를 들어 제대로 답했다. 칭찬하고 채점에 좋게 반영된다고 알려준다.",
    "- **need_reason**: 이유나 설명 없이 짧게만 답했다.",
    '  ("응", "아니", "그냥", "몰라", "좋아", "싫어" 처럼 근거가 없는 경우)',
    "  이유를 더 써보라고 안내한다.",
    "- **off_topic**: 토론 주제와 관계없는 이야기를 했다.",
    "  점수가 깎일 수 있다고 알리고 주제로 돌아오게 안내한다.",
    "- **none**: 위 셋 중 어디에도 뚜렷하게 해당하지 않는다. 굳이 말을 걸지 않는다.",
    "",
    "판단 기준:",
    "- 짧아도 이유가 있으면 praise 다. 길다고 praise 가 아니다.",
    "- 개인 경험이나 비유로 근거를 댔으면 주제 이탈이 아니다.",
    "- 상대 반론에 직접 답하지 않고 자기 말만 반복해도, 주제와 관련 있으면 off_topic 이 아니다.",
    "  이 경우 근거가 있으면 praise, 없으면 need_reason 이다.",
    "- 매번 칭찬하면 시끄럽다. 정말 잘했을 때만 praise 를 준다.",
    "",
    "coachMessage 쓰는 법:",
    `- 한 문장, ${p.maxSentenceLength}자 이내로 쓴다.`,
    `- ${p.vocabularyGuide}`,
    "- 혼내지 않는다. 무엇을 하면 좋은지 알려준다.",
    '- off_topic 일 때는 점수가 깎일 수 있다는 것을 꼭 알려준다.',
    '- praise 일 때는 채점에 좋게 반영된다는 것을 알려준다.',
    "- none 이면 빈 문자열로 둔다.",
  ].join("\n");
}
