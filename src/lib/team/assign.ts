/**
 * 팀 배정 (ver2 PRD V-R3, V-R32). 순수 함수.
 */

import { TEAM_ALIAS_PREFIX, type Side } from "./rules";

/** 활성 학생 전원을 두 팀에 인원 차이 1명 이내로 무작위로 나눈다. 홀수면 찬성팀이 1명 많다. */
export function randomAssign(
  studentIds: string[],
  rng: () => number = Math.random,
): Record<Side, string[]> {
  const ids = [...studentIds];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const half = Math.ceil(ids.length / 2);
  return { pro: ids.slice(0, half), con: ids.slice(half) };
}

/** 배정 경고 (저장은 막지 않는다) */
export function assignmentWarnings(proCount: number, conCount: number): string[] {
  const warnings: string[] = [];
  if (Math.abs(proCount - conCount) >= 2) {
    warnings.push(`두 팀 인원 차이가 ${Math.abs(proCount - conCount)}명이에요. 1명 이내로 맞추는 것이 좋아요.`);
  }
  if (proCount < 2 || conCount < 2) {
    warnings.push("한 팀이 2명보다 적어요. 팀 채팅으로 작전을 짜기 어려워요.");
  }
  return warnings;
}

/** AI 에 보내는 가명. DB(team_set_members)도 같은 형식으로 매긴다. */
export function aliasFor(side: Side, n: number): string {
  return `${TEAM_ALIAS_PREFIX[side]}${n}`;
}
