import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 팀 토론 채점·결과 서비스 (ver2 V-R30~V-R43).
 * DB 계층은 인메모리 대역, AI 는 의존성 주입으로 바꾼다.
 * `judgeSpeech` 는 실제로 예외를 삼키고 failed 를 돌려주므로 throw 로 목킹하지 않는다.
 */

import type { TeamMessageRow } from "@/lib/db/team-debates";
import type { TeamPhase } from "@/lib/team/rules";

type Side = "pro" | "con";

const NAMES = { m1: "김하늘", m2: "이바다", m3: "박구름", m4: "최나무" };

const db = {
  debate: null as null | Record<string, unknown>,
  members: [] as { id: string; student_id: string; side: Side; alias: string; speech_count: number; display_name: string }[],
  messages: [] as TeamMessageRow[],
  scores: new Map<string, Record<string, unknown>>(),
  penalties: [] as { side: Side; phase: string; points: number; reason: string }[],
  report: null as null | Record<string, unknown>,
  alerts: [] as Record<string, unknown>[],
};

vi.mock("@/lib/db/team-debates", () => ({
  getTeamDebate: async () => db.debate,
  getTeamMessage: async (id: string) => db.messages.find((m) => m.id === id) ?? null,
  listTeamMembers: async () => db.members,
  listFloorMessages: async () => db.messages.filter((m) => m.channel === "floor").sort((a, b) => a.seq - b.seq),
  listSpeechScores: async () => [...db.scores.values()],
  listPenalties: async () => db.penalties,
  listScoreEdits: async () => [],
  claimSpeechScore: async (messageId: string, debateId: string) => {
    if (db.scores.has(messageId)) return false;
    db.scores.set(messageId, { id: `sc-${messageId}`, message_id: messageId, debate_id: debateId, status: "pending", edited_at: null, total: null, attempts: 1 });
    return true;
  },
  reclaimSpeechScore: async (scoreId: string) => {
    const row = [...db.scores.values()].find((s) => s.id === scoreId);
    if (!row || row.status !== "failed" || row.edited_at) return null;
    row.status = "pending";
    return row;
  },
  saveSpeechScore: async (messageId: string, s: Record<string, unknown>) => {
    const row = db.scores.get(messageId);
    if (!row || row.edited_at) return false; // 교사가 고친 점수는 덮지 않는다
    Object.assign(row, { status: "done", total: s.total, logic: s.logic, reason: s.reason, phase_fit: s.phaseFit });
    return true;
  },
  failSpeechScore: async (messageId: string, error: string) => {
    const row = db.scores.get(messageId);
    if (row && !row.edited_at) Object.assign(row, { status: "failed", error });
  },
  claimTeamReport: async () => {
    if (db.report) return false;
    db.report = { status: "pending" };
    return true;
  },
  reclaimTeamReport: async () => {
    if (db.report?.status !== "failed") return false;
    db.report.status = "pending";
    return true;
  },
  getTeamReport: async () => db.report,
  saveTeamReport: async (_id: string, patch: Record<string, unknown>) => {
    db.report = { ...(db.report ?? {}), ...patch };
  },
  insertInappropriateAlert: async (a: Record<string, unknown>) => { db.alerts.push(a); },
}));

vi.mock("@/lib/ai/team-judge", () => ({
  judgeSpeech: async () => ({ failed: true, error: "기본 목: 테스트는 judge 를 주입한다" }),
  generateTeamFeedback: async () => { throw new Error("기본 목: 테스트는 feedback 을 주입한다"); },
}));
vi.mock("@/lib/ai/triage", () => ({ checkModeration: async () => ({ flagged: false, reason: null }) }));

import {
  buildJudgeInput,
  buildTeamReport,
  getStudentResult,
  moderateTeamMessage,
  runSpeechJudging,
  STUDENT_RESULT_KEYS,
} from "@/lib/team-scoring-service";
import { buildJudgeSystemPrompt, buildJudgeUserPrompt, type JudgeSpeechInput } from "@/lib/prompts/team-judge";
import { buildReportSystemPrompt, buildReportUserPrompt, stripAliases, type TeamReportInput } from "@/lib/prompts/team-report";
import type { JudgeResult } from "@/lib/ai/team-judge";

let seq = 0;
function speech(member: keyof typeof NAMES, phase: TeamPhase, content: string, extra: Partial<TeamMessageRow> = {}) {
  const m = db.members.find((x) => x.id === member)!;
  const row: TeamMessageRow = {
    id: `msg${++seq}`, debate_id: "d1", seq, channel: "floor", kind: "speech", phase,
    side: m.side, member_id: m.id, content, hidden_at: null, created_at: "", ...extra,
  };
  db.messages.push(row);
  return row;
}

const ok = (total = 4): JudgeResult => ({
  failed: false,
  parts: { logic: 2, evidence: 1, response: 1, phaseFit: 0, attitude: 0 },
  total,
  reason: "이유가 분명해요.",
  respondedToSeq: null,
  model: "test-model",
});
const fail: JudgeResult = { failed: true, error: "boom" };
const noSleep = async () => {};

beforeEach(() => {
  seq = 0;
  db.debate = {
    id: "d1", class_id: "c1", topic: "급식은 맛있어야 한다", description: null, grade_level: 4,
    status: "closed", phase: "ended", pro_name: "호랑이팀", con_name: "독수리팀", results_published_at: null,
  };
  db.members = [
    { id: "m1", student_id: "s1", side: "pro", alias: "찬성팀 학생1", speech_count: 2, display_name: NAMES.m1 },
    { id: "m2", student_id: "s2", side: "pro", alias: "찬성팀 학생2", speech_count: 0, display_name: NAMES.m2 },
    { id: "m3", student_id: "s3", side: "con", alias: "반대팀 학생1", speech_count: 1, display_name: NAMES.m3 },
    { id: "m4", student_id: "s4", side: "con", alias: "반대팀 학생2", speech_count: 0, display_name: NAMES.m4 },
  ];
  db.messages = [];
  db.scores = new Map();
  db.penalties = [];
  db.report = null;
  db.alerts = [];
});

describe("발언 채점 (V-R30, V-R35, V-R37)", () => {
  it("성공하면 서버가 합산한 점수를 저장한다", async () => {
    const m = speech("m1", "claim", "급식이 맛있으면 남기지 않아요. 우리 반도 그랬어요.");
    const judge = vi.fn(async () => ok(4));
    expect(await runSpeechJudging(m.id, { judge, sleep: noSleep })).toBe("done");
    expect(judge).toHaveBeenCalledTimes(1);
    expect(db.scores.get(m.id)).toMatchObject({ status: "done", total: 4 });
  });

  it("같은 발언을 두 번 동시에 채점해도 모델 호출은 1회 (V-AC28)", async () => {
    const m = speech("m1", "claim", "주장");
    const judge = vi.fn(async () => ok());
    const [a, b] = await Promise.all([
      runSpeechJudging(m.id, { judge, sleep: noSleep }),
      runSpeechJudging(m.id, { judge, sleep: noSleep }),
    ]);
    expect([a, b].sort()).toEqual(["already", "done"]);
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("실패하면 5초 뒤 1번 더, 그래도 실패면 failed (V-AC26)", async () => {
    const m = speech("m1", "claim", "주장");
    const judge = vi.fn(async () => fail);
    const sleep = vi.fn(async () => {});
    expect(await runSpeechJudging(m.id, { judge, sleep })).toBe("failed");
    expect(judge).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(db.scores.get(m.id)).toMatchObject({ status: "failed" });
  });

  it("첫 시도만 실패하면 재시도 결과를 저장한다", async () => {
    const m = speech("m1", "claim", "주장");
    const judge = vi.fn().mockResolvedValueOnce(fail).mockResolvedValueOnce(ok(3));
    expect(await runSpeechJudging(m.id, { judge, sleep: noSleep })).toBe("done");
    expect(db.scores.get(m.id)).toMatchObject({ status: "done", total: 3 });
  });

  it("교사의 다시 채점은 failed 만 다시 잡는다 (V-AC26)", async () => {
    const m = speech("m1", "claim", "주장");
    await runSpeechJudging(m.id, { judge: async () => fail, sleep: noSleep });
    const scoreId = db.scores.get(m.id)!.id as string;
    expect(await runSpeechJudging(m.id, { judge: async () => ok(5), retryScoreId: scoreId })).toBe("done");
    expect(db.scores.get(m.id)).toMatchObject({ status: "done", total: 5 });
    // 이미 done 이면 다시 잡지 않는다
    expect(await runSpeechJudging(m.id, { judge: async () => ok(1), retryScoreId: scoreId })).toBe("already");
  });

  it("교사가 고친 점수는 재채점이 덮지 않는다 (V-AC27)", async () => {
    const m = speech("m1", "claim", "주장");
    db.scores.set(m.id, { id: "sc1", message_id: m.id, status: "failed", edited_at: "2026-09-19", total: 2 });
    expect(await runSpeechJudging(m.id, { judge: async () => ok(5), retryScoreId: "sc1" })).toBe("already");
    expect(db.scores.get(m.id)).toMatchObject({ total: 2 });
  });

  it("채점 입력은 이전의 숨기지 않은 발언만, 실명 없이 가명으로 (V-R31, V-AC24)", async () => {
    speech("m1", "claim", "첫 주장");
    speech("m3", "claim", "숨길 발언", { hidden_at: "x" });
    speech("m3", "claim", "반대 주장");
    const target = speech("m2", "rebuttal", "반박");
    speech("m4", "rebuttal", "나중 발언");

    const input = (await buildJudgeInput(target)) as JudgeSpeechInput;
    expect(input.history.map((h) => h.content)).toEqual(["첫 주장", "반대 주장"]);
    expect(input.speech.alias).toBe("찬성팀 학생2");

    const prompt = buildJudgeSystemPrompt(input) + "\n" + buildJudgeUserPrompt(input);
    for (const name of Object.values(NAMES)) expect(prompt).not.toContain(name);
    expect(prompt).toContain("찬성팀 학생1");
    expect(prompt).toContain("반대팀 학생1");
    expect(prompt).not.toMatch(/moderation|verdict|inappropriate|부적절 판정/i);
    // 분량 규칙은 맨 끝 (debate.ts 와 같은 관례)
    const sys = buildJudgeSystemPrompt(input);
    expect(sys.lastIndexOf("# 분량 규칙")).toBeGreaterThan(sys.lastIndexOf("# 출력"));
  });
});

describe("부적절 판정 (V-R46)", () => {
  it("부적절이면 작성자와 함께 알림을 남긴다", async () => {
    const m = speech("m3", "claim", "나쁜 말");
    await moderateTeamMessage({ debateId: "d1", messageId: m.id, content: m.content }, async () => ({ flagged: true, reason: "harassment" }));
    expect(db.alerts).toEqual([
      expect.objectContaining({ messageId: m.id, memberId: "m3", side: "con", detail: "harassment" }),
    ]);
  });

  it("판정이 실패해도 던지지 않는다 (V-AC33)", async () => {
    const m = speech("m3", "claim", "말");
    await expect(
      moderateTeamMessage({ debateId: "d1", messageId: m.id, content: m.content }, async () => { throw new Error("down"); }),
    ).resolves.toBeUndefined();
    expect(db.alerts).toHaveLength(0);
  });
});

describe("결과 생성 (V-R38~V-R42)", () => {
  function scored(member: keyof typeof NAMES, phase: TeamPhase, total: number, extra: Partial<TeamMessageRow> = {}) {
    const m = speech(member, phase, `${phase} 발언`, extra);
    db.scores.set(m.id, { id: `sc-${m.id}`, message_id: m.id, status: "done", total, edited_at: null });
    return m;
  }

  const feedback = vi.fn(async (input: TeamReportInput) => ({
    feedback: {
      best: { pro: { point: "찬성팀 학생1 의 경험", why: "구체적" }, con: { point: "비용", why: "숫자" } },
      missed: ["영양"],
      suggestions: ["상대 근거 짚기"],
    },
    notesByAlias: Object.fromEntries(input.members.map((m) => [m.alias, "잘했어요"])),
    model: "test",
  }));

  beforeEach(() => { feedback.mockClear(); });

  it("발언이 없으면 결과를 만들지 않는다 (V-AC29)", async () => {
    expect(await buildTeamReport("d1", { feedback, sleep: noSleep })).toBe("skipped");
    expect(feedback).not.toHaveBeenCalled();
    expect(db.report).toMatchObject({ status: "skipped", winner: null });
  });

  it("서버가 합산·우승을 정하고, 잘한 점은 member_id 로 저장한다", async () => {
    scored("m1", "claim", 4);
    scored("m3", "claim", 3);
    scored("m3", "rebuttal", 5, { hidden_at: "x" }); // 숨김은 제외
    db.penalties.push({ side: "con", phase: "rebuttal", points: -1, reason: "연속 2회 패스" });

    expect(await buildTeamReport("d1", { feedback, sleep: noSleep })).toBe("done");
    expect(db.report).toMatchObject({ status: "done", pro_total: 4, con_total: 2, winner: "pro" });
    expect(db.report!.member_notes).toMatchObject({ m1: "잘했어요", m3: "잘했어요" });
  });

  it("동점이면 반론꺾기 점수가 높은 팀이 우승 (V-AC29)", async () => {
    scored("m1", "claim", 5);
    scored("m3", "claim", 3);
    scored("m1", "counter", 1);
    scored("m3", "counter", 3);
    expect(await buildTeamReport("d1", { feedback, sleep: noSleep })).toBe("done");
    expect(db.report).toMatchObject({ pro_total: 6, con_total: 6, winner: "con" });
  });

  it("채점 중인 발언을 기다렸다가 진행한다 (V-R38)", async () => {
    const m = speech("m1", "claim", "주장");
    db.scores.set(m.id, { id: "p", message_id: m.id, status: "pending", total: null, edited_at: null });
    const sleep = vi.fn(async () => { db.scores.get(m.id)!.status = "done"; db.scores.get(m.id)!.total = 4; });
    expect(await buildTeamReport("d1", { feedback, sleep, pollMs: 10, waitMs: 1000 })).toBe("done");
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(db.report).toMatchObject({ pro_total: 4, pending_count: 0 });
  });

  it("기다려도 채점이 안 끝나면 0점으로 치고 대기 건수를 남긴다", async () => {
    const m = speech("m1", "claim", "주장");
    db.scores.set(m.id, { id: "p", message_id: m.id, status: "pending", total: null, edited_at: null });
    expect(await buildTeamReport("d1", { feedback, sleep: noSleep, pollMs: 10, waitMs: 30 })).toBe("done");
    expect(db.report).toMatchObject({ pro_total: 0, pending_count: 1 });
  });

  it("결과 생성은 토론당 1회, 실패하면 failed → 다시 만들기 (V-AC28, V-R42)", async () => {
    scored("m1", "claim", 4);
    const broken = vi.fn(async () => { throw new Error("model down"); });
    const [a, b] = await Promise.all([
      buildTeamReport("d1", { feedback: broken, sleep: noSleep }),
      buildTeamReport("d1", { feedback: broken, sleep: noSleep }),
    ]);
    expect([a, b].sort()).toEqual(["already", "failed"]);
    expect(broken).toHaveBeenCalledTimes(1);
    expect(db.report).toMatchObject({ status: "failed", pro_total: 4, winner: "pro" });

    expect(await buildTeamReport("d1", { feedback, sleep: noSleep, retry: true })).toBe("done");
    expect(db.report).toMatchObject({ status: "done" });
  });

  it("결과 프롬프트에 실명이 없다 (V-AC24)", () => {
    const input: TeamReportInput = {
      topic: "급식", description: null, grade: 4, teamNames: { pro: "호랑이팀", con: "독수리팀" },
      totals: { pro: 4, con: 3, byStage: { claim: { pro: 4, con: 3 } } }, winner: "pro",
      transcript: [{ seq: 1, phase: "claim", side: "pro", alias: "찬성팀 학생1", content: "주장", total: 4 }],
      members: db.members.map((m) => ({ alias: m.alias, side: m.side, speechCount: m.speech_count })),
    };
    const prompt = buildReportSystemPrompt(4) + buildReportUserPrompt(input);
    for (const name of Object.values(NAMES)) expect(prompt).not.toContain(name);
    expect(prompt).toContain("찬성팀 학생1");
    expect(prompt).toContain("호랑이팀 승리");
  });

  it("반 전체에 보이는 문장의 가명은 팀 이름으로 바꾼다", () => {
    expect(stripAliases("찬성팀 학생1 의 경험과 반대팀 학생 2 의 숫자", { pro: "호랑이팀", con: "독수리팀" }))
      .toBe("호랑이팀 의 경험과 독수리팀 의 숫자");
  });
});

describe("학생 결과 (V-R43, V-AC31)", () => {
  it("공개 전에는 준비 중이고 점수가 없다", async () => {
    const r = await getStudentResult("d1");
    expect(r).toEqual({ status: "preparing", topic: "급식은 맛있어야 한다" });
  });

  it("공개 후 응답 키는 여섯 개뿐이고 학생 이름·발언 수·개인 잘한 점이 없다", async () => {
    db.debate!.results_published_at = "2026-09-19";
    const m = speech("m1", "claim", "주장");
    db.scores.set(m.id, { id: "s", message_id: m.id, status: "done", total: 4, edited_at: null });
    db.report = {
      status: "done",
      feedback: { best: { pro: { point: "a", why: "b" }, con: { point: "c", why: "d" } }, missed: ["x"], suggestions: ["y"] },
      member_notes: { m1: "김하늘은 잘했어요" },
    };
    const r = (await getStudentResult("d1")) as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual([...STUDENT_RESULT_KEYS].sort());
    const text = JSON.stringify(r);
    for (const name of Object.values(NAMES)) expect(text).not.toContain(name);
    expect(text).not.toMatch(/speechCount|member_notes|잘했어요|alias/);
    expect(r).toMatchObject({ winner: "pro", teams: { pro: { name: "호랑이팀", total: 4 }, con: { name: "독수리팀", total: 0 } } });
  });
});
