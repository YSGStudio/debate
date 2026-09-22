import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAGE_SECONDS,
  balanceBlocked,
  computeTeamTotals,
  decideWinner,
  defaultScoreVisibility,
  firstSide,
  isPenaltyPass,
  nextPhase,
  nextSide,
  partsInRange,
  speechTotal,
  type SpeechForTotals,
} from "@/lib/team/rules";
import { aliasFor, assignmentWarnings, randomAssign } from "@/lib/team/assign";
import { JUDGE_MAX, SPEECH_MAX_TOTAL } from "@/lib/prompts/team-judge-guide";

describe("단계와 차례 (V-R12)", () => {
  it("기본 시간은 3·8·8·8·6분이다", () => {
    expect(DEFAULT_STAGE_SECONDS).toEqual({ opening: 180, claim: 480, rebuttal: 480, counter: 480, final: 360 });
  });

  it("첫 차례는 찬성·반대·찬성·반대", () => {
    expect(firstSide("claim")).toBe("pro");
    expect(firstSide("rebuttal")).toBe("con");
    expect(firstSide("counter")).toBe("pro");
    expect(firstSide("final")).toBe("con");
    expect(firstSide("opening")).toBeNull();
  });

  it("다음 단계는 순서대로, 최종토론 다음은 없다", () => {
    expect(nextPhase("opening")).toBe("claim");
    expect(nextPhase("counter")).toBe("final");
    expect(nextPhase("final")).toBeNull();
    expect(nextPhase("waiting")).toBeNull();
  });

  it("보통은 상대 팀으로 넘어간다", () => {
    expect(nextSide("claim", "pro")).toBe("con");
    expect(nextSide("rebuttal", "con")).toBe("pro");
  });

  it("최종토론은 팀당 2회. 상대가 다 쓰면 같은 팀, 둘 다 쓰면 잠김", () => {
    expect(nextSide("final", "pro", { pro: 1, con: 2 })).toBe("pro");
    expect(nextSide("final", "con", { pro: 2, con: 1 })).toBe("con");
    expect(nextSide("final", "pro", { pro: 2, con: 2 })).toBeNull();
    expect(nextSide("final", null, { pro: 0, con: 0 })).toBe("con");
  });
});

describe("연속 패스 감점 (V-R23)", () => {
  it("두 번째 연속 패스에서만 감점", () => {
    expect(isPenaltyPass(["pass"])).toBe(false);
    expect(isPenaltyPass(["pass", "pass"])).toBe(true);
    expect(isPenaltyPass(["pass", "pass", "speech"])).toBe(true);
    expect(isPenaltyPass(["pass", "pass", "pass"])).toBe(false);
    expect(isPenaltyPass(["pass", "speech", "pass"])).toBe(false);
  });
});

describe("발언자 고르게 (V-R27)", () => {
  const base = { enabled: true, mySpeechCount: 2, turnElapsedMs: 5000, teammates: [{ speechCount: 0, online: true }] };

  it("2번 말한 학생은 차례 시작 15초 안에 막힌다", () => {
    expect(balanceBlocked(base)).toBe(true);
  });
  it("15초가 지나면 풀린다", () => {
    expect(balanceBlocked({ ...base, turnElapsedMs: 15000 })).toBe(false);
  });
  it("접속 중인 덜 말한 팀원이 없으면 막지 않는다", () => {
    expect(balanceBlocked({ ...base, teammates: [{ speechCount: 0, online: false }, { speechCount: 3, online: true }] })).toBe(false);
  });
  it("옵션이 꺼져 있거나 1번만 말했으면 막지 않는다", () => {
    expect(balanceBlocked({ ...base, enabled: false })).toBe(false);
    expect(balanceBlocked({ ...base, mySpeechCount: 1 })).toBe(false);
  });
});

describe("점수 공개 기본값 (V-R34)", () => {
  it("3~4학년 after_end, 5~6학년 live", () => {
    expect([3, 4, 5, 6].map(defaultScoreVisibility)).toEqual(["after_end", "after_end", "live", "live"]);
  });
});

describe("발언 점수 (V-R30)", () => {
  it("항목 최고점 합이 5점이다", () => {
    expect(JUDGE_MAX).toEqual({ logic: 2, evidence: 1, response: 1, phaseFit: 1 });
    expect(SPEECH_MAX_TOTAL).toBe(5);
  });

  it("항목 합 + 태도 감점", () => {
    expect(speechTotal({ logic: 2, evidence: 1, response: 1, phaseFit: 1, attitude: 0 })).toBe(5);
    expect(speechTotal({ logic: 2, evidence: 0, response: 1, phaseFit: 1, attitude: -1 })).toBe(3);
  });

  it("0 미만이면 0", () => {
    expect(speechTotal({ logic: 1, evidence: 0, response: 0, phaseFit: 0, attitude: -3 })).toBe(0);
  });

  it("태도가 양수로 와도 감점으로 친다, 범위 밖 값은 잘라낸다", () => {
    expect(speechTotal({ logic: 2, evidence: 1, response: 1, phaseFit: 1, attitude: 2 })).toBe(3);
    expect(speechTotal({ logic: 9, evidence: 9, response: 9, phaseFit: 9, attitude: -9 })).toBe(2);
  });

  it("교사 수정 범위 검사 (V-R36)", () => {
    expect(partsInRange({ logic: 2, evidence: 1, response: 0, phaseFit: 1, attitude: -3 })).toBe(true);
    expect(partsInRange({ logic: 3, evidence: 1, response: 0, phaseFit: 1, attitude: 0 })).toBe(false);
    expect(partsInRange({ logic: 1, evidence: 1, response: 0, phaseFit: 1, attitude: 1 })).toBe(false);
    expect(partsInRange({ logic: 1.5, evidence: 1, response: 0, phaseFit: 1, attitude: 0 })).toBe(false);
  });
});

describe("팀 총점과 우승 (V-R39, V-R40)", () => {
  const sp = (side: "pro" | "con", phase: SpeechForTotals["phase"], total: number | null, extra: Partial<SpeechForTotals> = {}): SpeechForTotals =>
    ({ side, phase, hidden: false, status: "done", total, ...extra });

  it("숨긴 발언은 빼고, failed·pending 은 0점, 감점은 더한다", () => {
    const t = computeTeamTotals(
      [
        sp("pro", "claim", 4),
        sp("pro", "claim", 5, { hidden: true }),
        sp("pro", "rebuttal", null, { status: "failed" }),
        sp("con", "claim", 3),
        sp("con", "counter", null, { status: "pending" }),
        sp("con", "counter", null, { status: null }),
      ],
      [{ side: "con", phase: "claim", points: -1 }],
    );
    expect(t.pro).toBe(4);
    expect(t.con).toBe(2);
    expect(t.byStage.claim).toEqual({ pro: 4, con: 2 });
    expect(t.byStage.rebuttal).toEqual({ pro: 0, con: 0 });
    expect(t.failedCount).toBe(1);
    expect(t.pendingCount).toBe(2);
    expect(t.speechCount).toBe(5);
  });

  it("총점이 높은 팀이 이긴다", () => {
    expect(decideWinner({ pro: 10, con: 8, byStage: {} })).toBe("pro");
  });

  it("동점이면 반론꺾기 점수, 그것도 같으면 무승부", () => {
    expect(decideWinner({ pro: 10, con: 10, byStage: { counter: { pro: 2, con: 4 } } })).toBe("con");
    expect(decideWinner({ pro: 10, con: 10, byStage: { counter: { pro: 3, con: 3 } } })).toBe("draw");
    expect(decideWinner({ pro: 10, con: 10, byStage: {} })).toBe("draw");
  });
});

describe("팀 배정 (V-R3)", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];

  it("7명은 4:3으로 나뉘고 빠지거나 겹치는 학생이 없다", () => {
    for (let seed = 0; seed < 20; seed++) {
      let x = seed + 1;
      const rng = () => ((x = (x * 16807) % 2147483647) / 2147483647);
      const r = randomAssign(ids, rng);
      expect([r.pro.length, r.con.length]).toEqual([4, 3]);
      expect([...r.pro, ...r.con].sort()).toEqual(ids);
    }
  });

  it("인원 차이 1명 이내는 경고 없음, 5:2 는 경고", () => {
    expect(assignmentWarnings(4, 3)).toEqual([]);
    expect(assignmentWarnings(5, 2).length).toBe(1);
    expect(assignmentWarnings(5, 1).length).toBe(2);
  });

  it("가명은 '찬성팀 학생1' 형식이다", () => {
    expect(aliasFor("pro", 1)).toBe("찬성팀 학생1");
    expect(aliasFor("con", 3)).toBe("반대팀 학생3");
  });
});
