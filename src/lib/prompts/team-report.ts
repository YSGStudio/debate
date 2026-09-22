/**
 * 팀 토론 종료 후 종합 피드백 프롬프트 (ver2 PRD V-R41).
 *
 * 점수·우승팀은 서버가 계산해 **입력으로** 준다. 모델이 정하지 않는다.
 * 학생은 가명으로만 나온다. 전체 피드백(best/missed/suggestions)은 학생에게도 보이므로
 * 개인을 가리키지 않고 팀 이름으로 쓰게 한다 (V-R43). 그래도 가명이 섞여 나오면
 * `stripAliases` 가 팀 이름으로 바꾼다.
 */

import { getPreset } from "@/lib/grade-presets";
import { PHASE_LABEL, TEAM_ALIAS_PREFIX, type Side, type TeamTotals } from "@/lib/team/rules";
import { renderLine, type JudgeLine } from "./team-judge";

export interface TeamReportInput {
  topic: string;
  description: string | null;
  grade: number;
  teamNames: Record<Side, string>;
  totals: Pick<TeamTotals, "pro" | "con" | "byStage">;
  winner: Side | "draw";
  /** 숨기지 않은 발언 (가명) + 서버 점수 */
  transcript: (JudgeLine & { total: number | null })[];
  members: { alias: string; side: Side; speechCount: number }[];
}

export function buildReportSystemPrompt(grade: number): string {
  const p = getPreset(grade);
  return [
    "너는 초등학생 팀 대항 토론의 심판이다. 토론이 끝났고, 점수와 우승팀은 이미 정해졌다.",
    "너는 점수를 바꾸지 않는다. 기록을 읽고 두 팀과 학생들에게 줄 피드백만 쓴다.",
    "",
    "# 쓸 것",
    "- best: 팀마다 가장 좋았던 논증 하나(point)와 그 이유(why).",
    "- missed: 두 팀이 놓친 반박 지점 1~2개.",
    "- suggestions: 다음 토론을 위한 제안 1~2개.",
    "- memberNotes: 발언한 학생마다 잘한 점 한 가지. alias 는 입력에 나온 가명을 그대로 쓴다.",
    "  발언이 없는 학생은 넣지 않는다.",
    "",
    "# 지킬 것",
    "- best, missed, suggestions 에는 학생 가명('찬성팀 학생1' 등)을 쓰지 않는다. 팀 이름으로만 말한다.",
    "  이 부분은 반 전체에게 보인다.",
    "- 진 팀을 깎아내리지 않는다. 두 팀 모두 잘한 점을 찾는다.",
    "- 기록에 없는 사실을 지어내지 않는다.",
    "",
    "# 분량 규칙 (반드시 지킨다)",
    `- 모든 문장은 초등학교 ${p.grade}학년이 읽는다. 한 문장은 ${p.maxSentenceLength}자 이내다.`,
    `- ${p.vocabularyGuide}`,
    "- 부족한 점은 '다음엔 ~해 보자' 처럼 격려하는 말로 쓴다.",
  ].join("\n");
}

export function buildReportUserPrompt(input: TeamReportInput): string {
  const n = input.teamNames;
  const stages = Object.entries(input.totals.byStage)
    .map(([ph, v]) => `${PHASE_LABEL[ph as keyof typeof PHASE_LABEL]} ${n.pro} ${v.pro} : ${n.con} ${v.con}`)
    .join(", ");
  const winner = input.winner === "draw" ? "무승부" : `${n[input.winner]} 승리`;
  const lines = input.transcript.map((l) => `${renderLine(l, n)}  (점수 ${l.total ?? "채점 대기"})`);
  const members = input.members.map((m) => `${m.alias} — 발언 ${m.speechCount}번`);
  return [
    `토론 주제: ${input.topic}`,
    input.description ? `보충 설명: ${input.description}` : null,
    `결과: ${winner} (${n.pro} ${input.totals.pro}점 : ${n.con} ${input.totals.con}점)`,
    stages ? `단계별: ${stages}` : null,
    "",
    "## 학생",
    ...members,
    "",
    "## 전체 토론방 기록",
    ...(lines.length ? lines : ["(발언 없음)"]),
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** 반 전체에게 보이는 문장에서 가명을 팀 이름으로 바꾼다 (V-R43 방어) */
export function stripAliases(text: string, names: Record<Side, string>): string {
  return (Object.keys(TEAM_ALIAS_PREFIX) as Side[]).reduce(
    (acc, side) => acc.replace(new RegExp(`${TEAM_ALIAS_PREFIX[side]}\\s*\\d+`, "g"), names[side]),
    text,
  );
}
