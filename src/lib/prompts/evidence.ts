import { getPreset } from "@/lib/grade-presets";
import { EVIDENCE_PER_SIDE } from "@/lib/evidence";

export interface EvidencePromptInput {
  topic: string;
  description: string | null;
  /** 자료를 찾을 쪽의 주장 한 문장 */
  claim: string;
}

/**
 * 1단계: 웹 검색으로 자료를 찾아 출처를 인용하며 정리하게 한다.
 *
 * 검색을 강제(`toolChoice`)하거나 JSON 으로 바로 받으려 하면 결과가 자주 비었다.
 * 강제하면 요청 문장이 통째로 검색어가 되고, JSON 만 쓰게 하면 인용 정보가 붙지 않는다.
 * 사람에게 부탁하듯 평범하게 요청하면 모델이 검색어를 스스로 만들고, 인용 주소가 확실히 붙는다.
 *
 * `avoid` 는 "더 찾기" 때 이미 가진 자료다. 다른 자료를 찾게 한다.
 */
export function buildResearchPrompt(input: EvidencePromptInput, avoid: string[] = []): string {
  return [
    `초등학생 토론 수업 주제: "${input.topic}"`,
    input.description ? `보충 설명: ${input.description}` : "",
    `"${input.claim}" 라는 주장을 뒷받침하는 연구 결과, 공공기관 조사, 국제기구 권고, 전문가 의견을 웹에서 찾아서 ${EVIDENCE_PER_SIDE.max}개 정리해 줘.`,
    "이 주장과 반대 결론을 내는 자료는 빼. 한국 자료를 먼저 찾고, 부족하면 해외 자료도 써.",
    "개인 블로그, 광고, 커뮤니티 글, 위키 문서는 쓰지 마.",
    "각 항목은 '누가 - 무엇을 알아냈는지' 한두 문장으로 쓰고, 항목마다 출처를 인용해.",
    avoid.length > 0
      ? `아래 자료는 이미 있으니 빼고, 다른 관점(건강·안전·공정성·비용·습관·관계 등)의 자료를 찾아 줘:\n${avoid.map((a) => `- ${a}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 2단계: 1단계의 정리 글을 교사가 검토할 항목으로 바꾼다 (소형 모델, 검색 없음).
 * 주소는 1단계에서 실제로 인용된 목록 안에서만 고르게 한다 — 서버가 한 번 더 대조한다.
 */
export function buildExtractPrompt(
  input: EvidencePromptInput & { grade: number },
  researched: string,
  citedUrls: string[],
): string {
  const p = getPreset(input.grade);
  return [
    "아래 조사 글에서 초등학생 토론에 쓸 근거 자료를 골라 정리하라.",
    "",
    `토론 주제: ${input.topic}`,
    `**이 주장을 뒷받침하는 자료만 고른다: "${input.claim}"**`,
    "- 이 주장과 반대 결론을 내는 자료, 주장에 대해 아무 말도 하지 않는 자료(단순 현황·규정 소개 등)는 뺀다.",
    "- 초등학생과 관련 없는 대상(대학생, 외국인 학습자 등)만 다룬 자료는 뺀다.",
    "- 조사 글이 스스로 '제외' 한다고 적은 항목은 뺀다.",
    "- 무섭거나 자극적인 내용은 뺀다.",
    "",
    "# 쓰는 법",
    `- finding: 초등학교 ${p.grade}학년이 알아듣는 쉬운 한국어 한 문장, 80자 안. 조사 글에 있는 내용만 쓰고 숫자·연도를 바꾸지 않는다.`,
    "- source: 기관이나 연구자 이름만 짧게 (예: 세계보건기구, 한국교육개발원, 서울대 연구팀). 논문 제목은 쓰지 않는다.",
    "- url: 그 항목에 인용된 주소를 아래 목록에서 그대로 고른다. 목록에 없는 주소는 쓰지 않는다.",
    "",
    "# 인용된 주소 목록",
    ...citedUrls.map((u) => `- ${u}`),
    "",
    "# 조사 글",
    researched,
  ].join("\n");
}
