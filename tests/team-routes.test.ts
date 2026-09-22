import { beforeEach, describe, expect, it, vi } from "vitest";

/** 팀 토론 API 라우트의 게이트 로직 (ver2). DB·AI 는 대역이다. */

const D = "11111111-1111-4111-8111-111111111111";

const state = {
  student: true as boolean,
  teacher: "t1" as string | null,
  owner: "t1",
  speakResult: "ok",
  claimResult: { result: "ok", holder: null as string | null },
  chatSlotOk: true,
  debateStatus: "open" as "draft" | "open" | "closed",
  pollError: null as string | null,
  controlResult: "ok" as string,
  score: null as null | { id: string; debate_id: string; status: string; edited_at: string | null; message_id: string },
};
const calls = {
  rpc: 0,
  background: [] as string[],
  judged: [] as string[],
  speak: [] as string[],
  edit: [] as Record<string, number>[],
  reportStarted: 0,
};

vi.mock("@/lib/session/student", () => ({
  getStudentSession: async () => (state.student ? { classId: "c1", studentId: "s1" } : null),
}));
vi.mock("@/lib/session/team-device", () => ({
  getDeviceId: async () => "dev-1",
  ensureDeviceId: async () => "dev-1",
}));
vi.mock("@/lib/session/teacher", () => ({
  getTeacherSession: async () => (state.teacher ? { teacherId: state.teacher } : null),
}));
vi.mock("@/lib/db/rate-limit", () => ({
  takeSlot: async () => state.chatSlotOk,
}));
vi.mock("@/lib/background", () => ({
  // 뒤에서 도는 작업은 기다리지 않는다. 라벨만 기록한다.
  runInBackground: (p: Promise<unknown>, label: string) => { calls.background.push(label); void p.catch(() => {}); },
}));
vi.mock("@/lib/team-scoring-service", () => ({
  runSpeechJudging: async (id: string) => { calls.judged.push(id); return "failed"; },
  moderateTeamMessage: async () => {},
  buildTeamReport: () => { calls.reportStarted++; return new Promise(() => {}); }, // 끝나지 않는 작업
  refreshReportTotals: async () => {},
}));

const debateRow = () => ({
  id: D, class_id: "c1", topic: "급식", description: null, grade_level: 4, status: state.debateStatus,
  phase: "claim", pro_name: "찬성팀", con_name: "반대팀", stage_seconds: {}, turn_seconds: 60,
  score_visibility: "after_end", speaker_balance: false, archived_at: null,
});

vi.mock("@/lib/db/team-debates", () => ({
  teamSpeak: async (_d: string, _s: unknown, content: string) => {
    calls.speak.push(content);
    return state.speakResult === "ok"
      ? { result: "ok", messageId: "msg-1", seq: 7 }
      : { result: state.speakResult, messageId: null, seq: null };
  },
  teamClaim: async () => state.claimResult,
  teamChat: async () => ({ result: "ok", messageId: "chat-1" }),
  teamPoll: async () => {
    calls.rpc++;
    return state.pollError ? { error: state.pollError } : { debate: { id: D }, messages: [] };
  },
  getOwnedTeamDebate: async (teacherId: string) =>
    teacherId === state.owner ? { debate: debateRow(), className: "4-1" } : null,
  getTeamDebate: async () => debateRow(),
  teamControl: async () => state.controlResult,
  getSpeechScore: async () => state.score,
  editSpeechScore: async (_s: unknown, _t: string, next: Record<string, number>) => { calls.edit.push(next); return { id: "sc1", ...next }; },
  openTeamDebateAtomic: async () => ({ result: "conflict", conflictTopic: "숙제 없애기" }),
}));

import { POST as speak } from "@/app/api/team/speak/route";
import { POST as chat } from "@/app/api/team/chat/route";
import { POST as claim } from "@/app/api/team/claim/route";
import { GET as studentPoll } from "@/app/api/team/poll/route";
import { GET as teacherPoll } from "@/app/api/team-debates/[debateId]/poll/route";
import { PATCH as patchDebate } from "@/app/api/team-debates/[debateId]/route";
import { PATCH as editScore } from "@/app/api/team-debates/[debateId]/scores/[scoreId]/route";

const json = (body: unknown) =>
  new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  Object.assign(state, {
    student: true, teacher: "t1", owner: "t1", speakResult: "ok",
    claimResult: { result: "ok", holder: null }, chatSlotOk: true, debateStatus: "open",
    pollError: null, controlResult: "ok", score: null,
  });
  calls.rpc = 0; calls.background = []; calls.judged = []; calls.speak = []; calls.edit = []; calls.reportStarted = 0;
});

describe("발언 (V-R25, V-R35)", () => {
  it("301자 발언은 400, 저장하지 않는다 (V-AC19)", async () => {
    const res = await speak(json({ debateId: D, content: "가".repeat(301) }));
    expect(res.status).toBe(400);
    expect(calls.speak).toHaveLength(0);
  });

  it("300자는 통과하고, 채점·판정은 뒤에서 돈다 — 채점이 실패해도 200 (V-AC26)", async () => {
    const res = await speak(json({ debateId: D, content: "가".repeat(300) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messageId: "msg-1", seq: 7 });
    expect(calls.background).toEqual(["team/발언 채점", "team/부적절 판정"]);
  });

  it("잠금 없는 학생은 409, 상대 차례도 409 (V-AC15, V-AC19)", async () => {
    state.speakResult = "no_lock";
    expect((await speak(json({ debateId: D, content: "말" }))).status).toBe(409);
    state.speakResult = "not_your_turn";
    const res = await speak(json({ debateId: D, content: "말" }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_your_turn");
    expect(calls.background).toHaveLength(0);
  });

  it("다른 기기에서 들어왔으면 409 replaced (V-AC8)", async () => {
    state.speakResult = "replaced";
    const res = await speak(json({ debateId: D, content: "말" }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("replaced");
  });

  it("로그인하지 않았으면 401", async () => {
    state.student = false;
    expect((await speak(json({ debateId: D, content: "말" }))).status).toBe(401);
  });
});

describe("잠금 (V-R24)", () => {
  it("다른 친구가 쓰고 있으면 이름과 함께 409", async () => {
    state.claimResult = { result: "locked", holder: "김하늘" };
    const res = await claim(json({ debateId: D }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("김하늘");
  });
});

describe("팀 채팅 (V-R28)", () => {
  it("2초 안에 다시 보내면 429 (V-AC22)", async () => {
    expect((await chat(json({ debateId: D, content: "작전" }))).status).toBe(200);
    state.chatSlotOk = false;
    expect((await chat(json({ debateId: D, content: "작전2" }))).status).toBe(429);
  });

  it("채팅은 200자, 못 보낸 발언은 300자까지", async () => {
    expect((await chat(json({ debateId: D, content: "가".repeat(201) }))).status).toBe(400);
    expect((await chat(json({ debateId: D, content: "가".repeat(300), draft: true }))).status).toBe(200);
  });
});

describe("폴링 (V-R49)", () => {
  it("학생 폴링 1회 = RPC 1회 (V-AC34)", async () => {
    const res = await studentPoll(new Request(`http://x/api/team/poll?debateId=${D}&since=5`));
    expect(res.status).toBe(200);
    expect(calls.rpc).toBe(1);
  });

  it("교사 폴링 1회 = RPC 1회, 남의 토론은 404", async () => {
    const res = await teacherPoll(new Request(`http://x?since=0`), ctx({ debateId: D }));
    expect(res.status).toBe(200);
    expect(calls.rpc).toBe(1);
    state.pollError = "not_found";
    expect((await teacherPoll(new Request("http://x"), ctx({ debateId: D }))).status).toBe(404);
  });

  it("배정되지 않은 학생은 404 (V-AC5)", async () => {
    state.pollError = "not_found";
    expect((await studentPoll(new Request(`http://x/api/team/poll?debateId=${D}`))).status).toBe(404);
  });
});

describe("교사 제어", () => {
  const patch = (body: unknown) => patchDebate(json(body), ctx({ debateId: D }));

  it("남의 토론은 404 (R4)", async () => {
    state.owner = "someone-else";
    expect((await patch({ action: "pause" })).status).toBe(404);
  });

  it("open 이후 설정 변경은 409 (V-AC1)", async () => {
    expect((await patch({ action: "update", topic: "새 주제" })).status).toBe(409);
  });

  it("입장 열기가 충돌하면 열린 쪽 주제를 알려준다 (V-AC3)", async () => {
    state.debateStatus = "draft";
    const res = await patch({ action: "open" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("숙제 없애기");
  });

  it("토론 종료는 결과 생성을 기다리지 않고 바로 응답한다 (V-AC30)", async () => {
    const res = await patch({ action: "end" }); // buildTeamReport 목은 끝나지 않는다
    expect(res.status).toBe(200);
    expect(calls.reportStarted).toBe(1);
    expect(calls.background).toEqual(["team/결과 생성"]);
  });
});

describe("점수 수정 (V-R36)", () => {
  const edit = (body: unknown) => editScore(json(body), ctx({ debateId: D, scoreId: "sc1" }));
  beforeEach(() => {
    state.score = { id: "sc1", debate_id: D, status: "done", edited_at: null, message_id: "m1" };
  });

  it("범위 밖이면 400 (V-AC27)", async () => {
    expect((await edit({ logic: 3, evidence: 1, response: 1, phaseFit: 1, attitude: 0 })).status).toBe(400);
    expect((await edit({ logic: 2, evidence: 1, response: 1, phaseFit: 1, attitude: 1 })).status).toBe(400);
    expect(calls.edit).toHaveLength(0);
  });

  it("범위 안이면 서버가 합산해 저장한다", async () => {
    const res = await edit({ logic: 1, evidence: 1, response: 0, phaseFit: 1, attitude: -2 });
    expect(res.status).toBe(200);
    expect(calls.edit[0]).toMatchObject({ total: 1 });
  });

  it("다른 토론의 점수는 404", async () => {
    state.score = { id: "sc1", debate_id: "other", status: "done", edited_at: null, message_id: "m1" };
    expect((await edit({ logic: 1, evidence: 1, response: 0, phaseFit: 1, attitude: 0 })).status).toBe(404);
  });
});
