/**
 * 팀 토론 규칙 (ver2 PRD V-R12, V-R20~V-R23, V-R27, V-R34, V-R39, V-R40).
 *
 * 같은 규칙이 SQL(0006_team_debate.sql 의 team_next_side, team_check_pass_penalty,
 * team_claim, team_poll 의 totals)에도 있다. 차례·잠금 판정은 SQL 이 **정본**이고,
 * 여기 함수는 결과 합산·화면 표시·단위 테스트용이다. 한쪽을 바꾸면 다른 쪽도 바꾼다.
 */

import { ATTITUDE_MIN, JUDGE_MAX, SPEECH_MAX_TOTAL } from "@/lib/prompts/team-judge-guide";

export type Side = "pro" | "con";

export const TEAM_PHASES = ["waiting", "opening", "claim", "rebuttal", "counter", "final", "ended"] as const;
export type TeamPhase = (typeof TEAM_PHASES)[number];

/** 시간이 정해진 단계 */
export const STAGE_PHASES = ["opening", "claim", "rebuttal", "counter", "final"] as const;
export type StagePhase = (typeof STAGE_PHASES)[number];

/** 전체 토론방에 발언하는 단계 */
export const FLOOR_PHASES = ["claim", "rebuttal", "counter", "final"] as const;
export type FloorPhase = (typeof FLOOR_PHASES)[number];

export const PHASE_LABEL: Record<TeamPhase, string> = {
  waiting: "대기",
  opening: "토론 시작",
  claim: "주장",
  rebuttal: "반론",
  counter: "반론꺾기",
  final: "최종토론",
  ended: "종료",
};

export const PHASE_GUIDE: Record<TeamPhase, string> = {
  waiting: "선생님이 토론을 시작하면 열려요.",
  opening: "팀 채팅으로 작전을 짜요. 토론방은 아직 잠겨 있어요.",
  claim: "우리 팀의 생각과 이유를 말해요.",
  rebuttal: "상대 팀 주장의 약한 점을 짚어요.",
  counter: "우리가 받은 반론에 다시 답해요.",
  final: "핵심을 정리하고 마지막으로 말해요. 팀당 2번까지예요.",
  ended: "토론이 끝났어요.",
};

/** 단계별 기본 시간(초) — V-R12 표 */
export const DEFAULT_STAGE_SECONDS: Record<StagePhase, number> = {
  opening: 180,
  claim: 480,
  rebuttal: 480,
  counter: 480,
  final: 360,
};

export const STAGE_MINUTES_MIN = 1;
export const STAGE_MINUTES_MAX = 20;
export const TURN_SECONDS_DEFAULT = 60;
export const TURN_SECONDS_MIN = 30;
export const TURN_SECONDS_MAX = 120;

/** 최종토론 팀당 발언 상한 */
export const FINAL_CAP = 2;
/** 발언 잠금 유지 시간 — 입력이 없으면 풀린다 (V-R24) */
export const LOCK_SECONDS = 20;
/** 입력 중 잠금 연장 요청 간격 */
export const CLAIM_HEARTBEAT_MS = 3000;
/** 차례 끝나기 전 경고 (V-R22) */
export const TURN_WARNING_SECONDS = 10;
/** 발언자 고르게: 차례 시작 후 이 시간 동안 제한 (V-R27) */
export const BALANCE_WINDOW_SECONDS = 15;
export const BALANCE_SPEECH_THRESHOLD = 2;
export const ONLINE_WINDOW_SECONDS = 10;

export const SPEECH_MAX_LEN = 300;
export const CHAT_MAX_LEN = 200;
export const CHAT_INTERVAL_MS = 2000;
export const NOTICE_MAX_LEN = 200;
export const POLL_INTERVAL_MS = 1500;

export const TEAM_ALIAS_PREFIX: Record<Side, string> = { pro: "찬성팀 학생", con: "반대팀 학생" };

export function isFloorPhase(p: TeamPhase): p is FloorPhase {
  return (FLOOR_PHASES as readonly string[]).includes(p);
}

export function otherSide(s: Side): Side {
  return s === "pro" ? "con" : "pro";
}

/** 단계별 첫 차례: 주장 찬성, 반론 반대, 반론꺾기 찬성, 최종 반대 */
export function firstSide(phase: TeamPhase): Side | null {
  switch (phase) {
    case "claim":
      return "pro";
    case "rebuttal":
      return "con";
    case "counter":
      return "pro";
    case "final":
      return "con";
    default:
      return null;
  }
}

/** 다음 단계. 최종토론 다음은 "토론 종료" 로만 간다. */
export function nextPhase(phase: TeamPhase): TeamPhase | null {
  const order: TeamPhase[] = ["opening", "claim", "rebuttal", "counter", "final"];
  const i = order.indexOf(phase);
  if (i < 0 || i === order.length - 1) return null;
  return order[i + 1];
}

/**
 * 다음 차례 편. 보통 상대 팀.
 * 최종토론은 팀당 2회 상한이라 상대가 다 썼으면 같은 팀, 둘 다 썼으면 null (토론방 잠김).
 */
export function nextSide(
  phase: TeamPhase,
  prev: Side | null,
  finalSpeeches: Record<Side, number> = { pro: 0, con: 0 },
): Side | null {
  const first = prev === null ? firstSide(phase) : otherSide(prev);
  if (!first) return null;
  if (phase !== "final") return first;
  if (finalSpeeches[first] < FINAL_CAP) return first;
  const second = otherSide(first);
  if (finalSpeeches[second] < FINAL_CAP) return second;
  return null;
}

/**
 * 연속 패스 감점 여부 (V-R23).
 * `history` 는 그 팀의 차례 결과를 **최신순**으로 (단계 종료로 끊긴 차례는 빼고).
 * 연속 횟수가 정확히 2가 되는 순간에만 감점한다.
 */
export function isPenaltyPass(history: ("speech" | "pass")[]): boolean {
  return history[0] === "pass" && history[1] === "pass" && history[2] !== "pass";
}

/** 발언자 고르게 (V-R27): 이 학생이 지금 잠금을 새로 얻지 못하는가 */
export function balanceBlocked(input: {
  enabled: boolean;
  mySpeechCount: number;
  turnElapsedMs: number;
  teammates: { speechCount: number; online: boolean }[];
}): boolean {
  if (!input.enabled) return false;
  if (input.mySpeechCount < BALANCE_SPEECH_THRESHOLD) return false;
  if (input.turnElapsedMs >= BALANCE_WINDOW_SECONDS * 1000) return false;
  return input.teammates.some((t) => t.online && t.speechCount < BALANCE_SPEECH_THRESHOLD);
}

/** 점수 공개 방식 기본값 (V-R34): 3~4학년은 종료 후, 5~6학년은 실시간 */
export function defaultScoreVisibility(grade: number): "live" | "after_end" {
  return grade <= 4 ? "after_end" : "live";
}

// ── 점수 합산 (V-R30, V-R39, V-R40). 모델에게 산술을 맡기지 않는다. ──────────

export interface SpeechParts {
  logic: number;
  evidence: number;
  response: number;
  phaseFit: number;
  attitude: number;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** 범위를 벗어난 값을 바로잡는다. 태도가 양수로 와도 감점으로 취급한다. */
export function normalizeParts(p: SpeechParts): SpeechParts {
  return {
    logic: clamp(p.logic, 0, JUDGE_MAX.logic),
    evidence: clamp(p.evidence, 0, JUDGE_MAX.evidence),
    response: clamp(p.response, 0, JUDGE_MAX.response),
    phaseFit: clamp(p.phaseFit, 0, JUDGE_MAX.phaseFit),
    attitude: clamp(-Math.abs(p.attitude), ATTITUDE_MIN, 0),
  };
}

/** 발언 점수 = 네 항목 합 + 태도 감점, 0 미만이면 0 */
export function speechTotal(parts: SpeechParts): number {
  const p = normalizeParts(parts);
  const sum = p.logic + p.evidence + p.response + p.phaseFit + p.attitude;
  return Math.min(SPEECH_MAX_TOTAL, Math.max(0, sum));
}

/** 교사 수정 값이 범위 안인지 (V-R36). 바로잡지 않고 거부하기 위해 따로 둔다. */
export function partsInRange(p: SpeechParts): boolean {
  const ok = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
  return (
    ok(p.logic, 0, JUDGE_MAX.logic) &&
    ok(p.evidence, 0, JUDGE_MAX.evidence) &&
    ok(p.response, 0, JUDGE_MAX.response) &&
    ok(p.phaseFit, 0, JUDGE_MAX.phaseFit) &&
    ok(p.attitude, ATTITUDE_MIN, 0)
  );
}

export interface SpeechForTotals {
  side: Side;
  phase: TeamPhase;
  hidden: boolean;
  status: "pending" | "done" | "failed" | "skipped" | null;
  total: number | null;
}

export interface PenaltyForTotals {
  side: Side;
  phase: TeamPhase;
  points: number;
}

export interface TeamTotals {
  pro: number;
  con: number;
  byStage: Partial<Record<TeamPhase, Record<Side, number>>>;
  /** 채점 중 (행이 아직 없거나 pending) */
  pendingCount: number;
  /** 채점 대기 (failed) — 0점으로 친다 */
  failedCount: number;
  /** 숨기지 않은 발언 수 */
  speechCount: number;
}

/**
 * 팀 총점 = 숨기지 않은 발언 점수 합 + 연속 패스 감점. 단계별로도 같은 규칙.
 * `failed`·`pending` 발언은 0점으로 친다.
 */
export function computeTeamTotals(speeches: SpeechForTotals[], penalties: PenaltyForTotals[]): TeamTotals {
  const totals: TeamTotals = { pro: 0, con: 0, byStage: {}, pendingCount: 0, failedCount: 0, speechCount: 0 };
  const add = (side: Side, phase: TeamPhase, pts: number) => {
    totals[side] += pts;
    const stage = (totals.byStage[phase] ??= { pro: 0, con: 0 });
    stage[side] += pts;
  };

  for (const s of speeches) {
    if (s.hidden) continue;
    totals.speechCount++;
    if (s.status === null || s.status === "pending") totals.pendingCount++;
    if (s.status === "failed") totals.failedCount++;
    add(s.side, s.phase, s.status === "done" ? (s.total ?? 0) : 0);
  }
  for (const p of penalties) add(p.side, p.phase, p.points);
  return totals;
}

/** 우승팀 (V-R40): 총점 → 반론꺾기 점수 → 무승부 */
export function decideWinner(t: Pick<TeamTotals, "pro" | "con" | "byStage">): Side | "draw" {
  if (t.pro !== t.con) return t.pro > t.con ? "pro" : "con";
  const c = t.byStage.counter ?? { pro: 0, con: 0 };
  if (c.pro !== c.con) return c.pro > c.con ? "pro" : "con";
  return "draw";
}
