/**
 * 팀 토론 모드 E2E 검증 (ver2 PRD Verification - Agent 5).
 *
 *   npm run dev              # 다른 터미널에서
 *   npm run verify:team
 *
 * 주의: 연결된 Supabase 에 실제로 데이터를 쓰고 지운다. OpenAI 도 실제로 부른다 (발언 채점·결과·부적절 판정).
 * 만드는 것은 `team-` 로 시작하는 교사 계정, `TEAM` 으로 시작하는 초대 코드, "검증 팀토론반" 학급뿐이며
 * 끝나면 모두 지운다. **운영 DB 에서 돌리지 말 것.**
 *
 * 시간 초과는 대부분 service role 로 마감 시각을 앞당겨 흉내 낸다. V-AC16 만 실제로 30초를 기다린다.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? "  O" : "  X"} ${id}  ${detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeAgent() {
  const jar = new Map();
  return {
    async fetch(path, init = {}) {
      const headers = new Headers(init.headers ?? {});
      if (jar.size > 0) headers.set("cookie", [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const idx = pair.indexOf("=");
        jar.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
      return res;
    },
    async json(path, init = {}) {
      const res = await this.fetch(path, init);
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    },
    post(path, body) { return this.json(path, { method: "POST", body: JSON.stringify(body ?? {}) }); },
    patch(path, body) { return this.json(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }); },
    put(path, body) { return this.json(path, { method: "PUT", body: JSON.stringify(body ?? {}) }); },
  };
}

const stamp = Date.now();
const INVITE = `TEAM${stamp}`;

async function cleanup() {
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  for (const u of users?.users ?? []) {
    if (u.email?.startsWith("team-")) {
      const { data: cls } = await db.from("classes").select("id").eq("teacher_id", u.id);
      for (const c of cls ?? []) await db.from("classes").delete().eq("id", c.id);
      await db.from("teachers").delete().eq("id", u.id);
      await db.auth.admin.deleteUser(u.id);
    }
  }
  await db.from("invite_codes").delete().like("code", "TEAM%");
}

/** 시간 경과 흉내: 열린 차례·잠금·단계 마감(·일시정지 시각)을 secs 초 앞당긴다 */
async function age(debateId, secs, { turnOnly = false, phaseOnly = false } = {}) {
  const shift = (iso) => (iso ? new Date(new Date(iso).getTime() - secs * 1000).toISOString() : iso);
  if (!phaseOnly) {
    const { data: turns } = await db.from("team_turns").select("id, started_at, deadline_at, lock_expires_at")
      .eq("debate_id", debateId).is("ended_at", null);
    for (const t of turns ?? []) {
      await db.from("team_turns").update({
        started_at: shift(t.started_at), deadline_at: shift(t.deadline_at), lock_expires_at: shift(t.lock_expires_at),
      }).eq("id", t.id);
    }
  }
  if (!turnOnly) {
    const { data: d } = await db.from("team_debates").select("phase_deadline_at, paused_at").eq("id", debateId).single();
    await db.from("team_debates").update({ phase_deadline_at: shift(d.phase_deadline_at), paused_at: shift(d.paused_at) }).eq("id", debateId);
  }
}

async function main() {
  console.log(`대상: ${BASE}\n`);
  await cleanup();
  await db.from("invite_codes").insert({ code: INVITE, note: "verify-team", max_uses: 2, is_active: true });

  const T = makeAgent();
  const TB = makeAgent();
  await T.post("/api/teacher/signup", { email: `team-a-${stamp}@example.com`, password: "team-password-1234", name: "검증 팀 선생 A", inviteCode: INVITE });
  await TB.post("/api/teacher/signup", { email: `team-b-${stamp}@example.com`, password: "team-password-1234", name: "검증 팀 선생 B", inviteCode: INVITE });

  let r = await T.post("/api/classes", { name: "검증 팀토론반", gradeLevel: 4 });
  const cls = r.body.class;
  const names = ["팀가영", "팀나래", "팀다온", "팀라희", "팀마루", "팀바다", "팀사랑"];
  await T.post(`/api/classes/${cls.id}/students`, { mode: "bulk", raw: names.join("\n") });
  const { body: clsBody } = await T.json(`/api/classes/${cls.id}`);
  const sid = Object.fromEntries(clsBody.students.map((s) => [s.display_name, s.id]));

  // ── V-AC1 ────────────────────────────────────────────────────────
  console.log("[V-AC1] 만들기 기본값");
  r = await T.post("/api/team-debates", { classId: cls.id, topic: "급식은 맛있어야 한다" });
  const debate = r.body.debate;
  const D = debate.id;
  const base = `/api/team-debates/${D}`;
  check("V-AC1-a", r.status === 201 && debate.pro_name === "찬성팀" && debate.con_name === "반대팀" && debate.turn_seconds === 60
    && Object.entries({ opening: 180, claim: 480, rebuttal: 480, counter: 480, final: 360 }).every(([k, v]) => debate.stage_seconds[k] === v)
    && debate.grade_level === 4 && debate.score_visibility === "after_end",
    `${r.status} ${debate.pro_name}/${debate.con_name} ${JSON.stringify(debate.stage_seconds)} 차례 ${debate.turn_seconds}초 학년 ${debate.grade_level} 공개 ${debate.score_visibility}`);
  r = await T.patch(base, { action: "update", turnSeconds: 30 });
  check("V-AC1-b", r.status === 200 && r.body.debate.turn_seconds === 30, `draft 에서 차례 30초로 수정 → ${r.status}`);
  r = await TB.json(base);
  check("V-AC1-c", r.status === 404, `다른 교사 조회 → ${r.status}`);

  // ── V-AC2 ────────────────────────────────────────────────────────
  console.log("[V-AC2] 팀 배정");
  const members = (pro, con) => [...pro.map((n) => ({ studentId: sid[n], side: "pro" })), ...con.map((n) => ({ studentId: sid[n], side: "con" }))];
  r = await T.put(`${base}/members`, { members: members(["팀가영", "팀나래", "팀다온", "팀라희", "팀마루"], ["팀바다", "팀사랑"]) });
  check("V-AC2-a", r.status === 200 && r.body.warnings.length >= 1, `5:2 저장 → ${r.status}, 경고 "${r.body.warnings?.[0]}"`);
  // 최종 배정: 찬성 가영·나래·다온 / 반대 라희·마루·바다 / 사랑 미배정
  r = await T.put(`${base}/members`, { members: members(["팀가영", "팀나래", "팀다온"], ["팀라희", "팀마루", "팀바다"]) });
  check("V-AC2-b", r.status === 200 && r.body.warnings.length === 0, `3:3 저장 → ${r.status}, 경고 ${r.body.warnings?.length}건`);
  const { data: aliasRows } = await db.from("team_members").select("alias").eq("debate_id", D);
  check("V-AC2-c", aliasRows.map((a) => a.alias).sort().join(",") === "반대팀 학생1,반대팀 학생2,반대팀 학생3,찬성팀 학생1,찬성팀 학생2,찬성팀 학생3", `가명 ${aliasRows.length}개`);

  // ── V-AC3 ────────────────────────────────────────────────────────
  console.log("[V-AC3] 한 번에 하나만 열기 (1:1 ↔ 팀)");
  const s1 = (await T.post("/api/sessions", { classId: cls.id, topic: "숙제는 없어져야 한다", messageLimit: 30 })).body.session;
  await T.patch(`/api/sessions/${s1.id}`, { action: "open" });
  r = await T.patch(base, { action: "open" });
  check("V-AC3-a", r.status === 409 && r.body.openTopic === s1.topic, `1:1 이 열린 상태에서 팀 입장 열기 → ${r.status} "${r.body.openTopic}"`);
  await T.patch(`/api/sessions/${s1.id}`, { action: "close" });
  const [o1, o2] = await Promise.all([T.patch(base, { action: "open" }), T.patch(base, { action: "open" })]);
  check("V-AC3-b", [o1.status, o2.status].sort().join(",") === "200,409", `동시 입장 열기 2회 → ${o1.status}, ${o2.status}`);
  const s2 = (await T.post("/api/sessions", { classId: cls.id, topic: "휴대폰 허용", messageLimit: 30 })).body.session;
  r = await T.patch(`/api/sessions/${s2.id}`, { action: "open" });
  check("V-AC3-c", r.status === 409 && r.body.openTopic === debate.topic, `팀이 열린 상태에서 1:1 열기 → ${r.status} "${r.body.openTopic}"`);

  // ── V-AC4 (진행 중 거부) ─────────────────────────────────────────
  r = await T.patch(base, { action: "archive" });
  const r2 = await T.json(base, { method: "DELETE" });
  check("V-AC4-a", r.status === 409 && r2.status === 409, `진행 중 보관 → ${r.status}, 삭제 → ${r2.status}`);
  r = await T.patch(`/api/classes/${cls.id}`, { action: "archive" });
  check("V-AC4-b", r.status === 409 && (r.body.openTopics ?? []).includes(debate.topic), `열린 팀 토론이 있는 학급 보관 → ${r.status}`);

  // ── 학생 입장 ────────────────────────────────────────────────────
  console.log("[V-AC5/6] 학생 입장·대기실");
  const S = {};
  for (const n of names) {
    S[n] = makeAgent();
    await S[n].post("/api/join/enter", { code: cls.join_code, studentId: sid[n] });
  }
  r = await S["팀가영"].json("/api/debate/state");
  const r3 = await S["팀사랑"].json("/api/debate/state");
  check("V-AC5-a", (r.body.teamDebates ?? []).some((t) => t.id === D) && !(r3.body.teamDebates ?? []).some((t) => t.id === D),
    `배정 학생 목록 ${r.body.teamDebates?.length}개, 미배정 학생 목록 ${r3.body.teamDebates?.length}개`);
  const enterU = await S["팀사랑"].post("/api/team/enter", { debateId: D });
  const pollU = await S["팀사랑"].json(`/api/team/poll?debateId=${D}`);
  check("V-AC5-b", enterU.status === 404 && pollU.status === 404, `미배정 학생 입장 ${enterU.status}, 폴링 ${pollU.status}`);
  const lookup = await makeAgent().post("/api/join/lookup", { code: cls.join_code });
  check("V-AC5-c", lookup.body.openTeamDebateCount === 1, `코드 조회의 열린 팀 토론 수 = ${lookup.body.openTeamDebateCount}`);

  const players = ["팀가영", "팀나래", "팀다온", "팀라희", "팀마루", "팀바다"];
  for (const n of players) await S[n].post("/api/team/enter", { debateId: D });
  const poll = (n, since = 0) => S[n].json(`/api/team/poll?debateId=${D}&since=${since}`);
  const tpoll = (since = 0) => T.json(`${base}/poll?since=${since}`);
  r = await poll("팀가영");
  check("V-AC6", r.status === 200 && r.body.debate.phase === "waiting" && r.body.floorState === "closed"
    && r.body.members.map((m) => m.name).sort().join(",") === "팀가영,팀나래,팀다온",
    `대기실: 단계 ${r.body.debate?.phase}, 토론방 ${r.body.floorState}, 팀원 ${r.body.members?.map((m) => m.name).join(",")}`);

  // ── V-AC8 중복 접속 ──────────────────────────────────────────────
  console.log("[V-AC8] 다른 기기");
  const second = makeAgent();
  await second.post("/api/join/enter", { code: cls.join_code, studentId: sid["팀가영"] });
  await second.post("/api/team/enter", { debateId: D });
  r = await poll("팀가영");
  let t = await tpoll();
  check("V-AC8", r.status === 409 && r.body.code === "replaced" && t.body.alerts.some((a) => a.kind === "duplicate_login"),
    `앞 기기 폴링 → ${r.status} ${r.body.code}, 관제실 알림 ${t.body.alerts.map((a) => a.kind).join(",")}`);
  S["팀가영"] = second; // 이후엔 새 기기로

  // ── 시작 + 팀 채팅 (V-AC7) ───────────────────────────────────────
  console.log("[V-AC7] 팀 채팅 분리");
  r = await T.patch(base, { action: "start" });
  await S["팀가영"].post("/api/team/chat", { debateId: D, content: "찬성팀 작전: 남는 음식 이야기" });
  await sleep(2100);
  await S["팀라희"].post("/api/team/chat", { debateId: D, content: "반대팀 비밀 작전: 비용 이야기" });
  r = await poll("팀나래");
  const raw = JSON.stringify(r.body);
  t = await tpoll();
  check("V-AC7", raw.includes("찬성팀 작전") && !raw.includes("반대팀 비밀 작전") && JSON.stringify(t.body).includes("반대팀 비밀 작전"),
    `찬성 학생 응답에 반대 채팅 ${raw.includes("반대팀 비밀 작전") ? "있음" : "없음"}, 교사는 두 팀 모두 봄`);
  const claimOpening = await S["팀가영"].post("/api/team/claim", { debateId: D });
  check("V-AC7-b", claimOpening.status === 409 && r.body.floorState === "team_only", `토론 시작 단계 잠금 요청 → ${claimOpening.status}, 토론방 ${r.body.floorState}`);

  // ── 주장 단계 ────────────────────────────────────────────────────
  console.log("[V-AC10/15/18/19] 주장 단계");
  await T.patch(base, { action: "next" });
  r = await poll("팀가영");
  check("V-AC10-a", r.body.debate.phase === "claim" && r.body.turn?.side === "pro", `주장 첫 차례 ${r.body.turn?.side}`);

  const [c1, c2] = await Promise.all([
    S["팀가영"].post("/api/team/claim", { debateId: D }),
    S["팀나래"].post("/api/team/claim", { debateId: D }),
  ]);
  check("V-AC18-a", [c1.status, c2.status].sort().join(",") === "200,409", `동시 잠금 → ${c1.status}, ${c2.status}`);
  const holder = c1.status === 200 ? "팀가영" : "팀나래";

  r = await S[holder].post("/api/team/speak", { debateId: D, content: "가".repeat(301) });
  const noLock = await S["팀다온"].post("/api/team/speak", { debateId: D, content: "잠금 없이" });
  check("V-AC19", r.status === 400 && noLock.status === 409, `301자 → ${r.status}, 잠금 없는 학생 → ${noLock.status} ${noLock.body.code}`);

  r = await S[holder].post("/api/team/speak", { debateId: D, content: "급식이 맛있으면 음식을 덜 남겨요. 우리 반도 맛있는 날엔 잔반이 거의 없었어요." });
  const speechMsgId = r.body.messageId;
  const afterSpeak = await poll("팀라희");
  const wrongSide = await S[holder].post("/api/team/speak", { debateId: D, content: "또 말하기" });
  check("V-AC15", r.status === 200 && afterSpeak.body.turn?.side === "con" && afterSpeak.body.turn.remainingMs > 28000 && wrongSide.status === 409,
    `발언 → ${r.status}, 다음 차례 ${afterSpeak.body.turn?.side} 남은 ${afterSpeak.body.turn?.remainingMs}ms (차례 30초), 상대 차례에 찬성 발언 → ${wrongSide.status}`);

  // V-AC23: 5초 안에 교사 화면 점수
  const t0 = Date.now();
  let sc = null;
  while (Date.now() - t0 < 15000) {
    t = await tpoll();
    sc = t.body.scores?.find((s) => s.seq === r.body.seq && s.status === "done");
    if (sc) break;
    await sleep(500);
  }
  const elapsed = Date.now() - t0;
  const sum = sc ? Math.max(0, sc.logic + sc.evidence + sc.response + sc.phaseFit + sc.attitude) : null;
  check("V-AC23", !!sc && elapsed <= 5000 && sc.total === sum && !!sc.reason,
    sc ? `${elapsed}ms 만에 ${sc.total}점 (항목합 ${sum}) "${sc.reason}"` : `15초 안에 점수 없음`);

  // ── V-AC16: 실제 30초 대기 후 30건 동시 폴링 ───────────────────────
  console.log("[V-AC16] 실제 시간 초과 (30초 대기)");
  const lead = afterSpeak.body.turn.remainingMs;
  await sleep(lead + 1500);
  const burst = [];
  for (let i = 0; i < 30; i++) burst.push(i % 6 === 5 ? tpoll() : poll(players[i % 6]));
  await Promise.all(burst);
  const { data: passes1 } = await db.from("team_messages").select("seq, content").eq("debate_id", D).eq("kind", "pass");
  r = await poll("팀가영");
  check("V-AC16", passes1.length === 1 && passes1[0].content === "반대팀 패스" && r.body.turn?.side === "pro",
    `패스 ${passes1.length}건 "${passes1[0]?.content}", 다음 차례 ${r.body.turn?.side}`);

  // ── V-AC17: 반대팀 두 번째 연속 패스 → 감점 1회 ─────────────────────
  console.log("[V-AC17] 연속 패스");
  await S["팀다온"].post("/api/team/claim", { debateId: D });
  await S["팀다온"].post("/api/team/speak", { debateId: D, content: "맛있으면 영양도 골고루 먹게 돼요." });
  await age(D, 31, { turnOnly: true }); await tpoll();
  t = await tpoll();
  const pen1 = t.body.penalties.length;
  const passAlert = t.body.alerts.filter((a) => a.kind === "consecutive_pass").length;
  await age(D, 31, { turnOnly: true }); await tpoll(); // 찬성 패스
  await age(D, 31, { turnOnly: true }); await tpoll(); // 반대 세 번째
  t = await tpoll();
  check("V-AC17", pen1 === 1 && passAlert === 1 && t.body.penalties.length === 1 && t.body.penalties[0].side === "con" && t.body.penalties[0].points === -1,
    `두 번째 연속 패스 뒤 감점 ${pen1}건·알림 ${passAlert}건, 세 번째 뒤 감점 ${t.body.penalties.length}건`);

  // ── V-AC18-b: 잠금 20초 만료 ─────────────────────────────────────
  console.log("[V-AC18/21] 잠금 만료·발언자 고르게");
  r = await poll("팀가영");
  if (r.body.turn?.side !== "pro") { await age(D, 31, { turnOnly: true }); await tpoll(); }
  await S["팀가영"].post("/api/team/claim", { debateId: D });
  const blocked = await S["팀나래"].post("/api/team/claim", { debateId: D });
  const { data: openTurn } = await db.from("team_turns").select("id, lock_expires_at").eq("debate_id", D).is("ended_at", null).single();
  await db.from("team_turns").update({ lock_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", openTurn.id);
  const taken = await S["팀나래"].post("/api/team/claim", { debateId: D });
  check("V-AC18-b", blocked.status === 409 && taken.status === 200, `잠금 중 다른 학생 → ${blocked.status}, 20초 지난 뒤 → ${taken.status}`);

  // V-AC21 발언자 고르게 (설정은 draft 에서만 바뀌므로 DB 로 켠다)
  await db.from("team_debates").update({ speaker_balance: true }).eq("id", D);
  await db.from("team_turns").update({ lock_member_id: null, started_at: new Date().toISOString() }).eq("id", openTurn.id);
  const { data: memRows } = await db.from("team_members").select("id, student_id").eq("debate_id", D);
  const mid = Object.fromEntries(memRows.map((m) => [m.student_id, m.id]));
  await db.from("team_members").update({ speech_count: 2 }).eq("id", mid[sid["팀가영"]]);
  await db.from("team_members").update({ speech_count: 0 }).eq("id", mid[sid["팀나래"]]);
  await poll("팀나래"); // 나래 접속 중
  const bw = await S["팀가영"].post("/api/team/claim", { debateId: D });
  await db.from("team_turns").update({ started_at: new Date(Date.now() - 16000).toISOString() }).eq("id", openTurn.id);
  const bok = await S["팀가영"].post("/api/team/claim", { debateId: D });
  await db.from("team_turns").update({ lock_member_id: null, started_at: new Date().toISOString() }).eq("id", openTurn.id);
  await db.from("team_members").update({ last_seen_at: new Date(Date.now() - 60000).toISOString() }).eq("debate_id", D).neq("id", mid[sid["팀가영"]]);
  const bnobody = await S["팀가영"].post("/api/team/claim", { debateId: D });
  check("V-AC21", bw.status === 409 && bw.body.code === "balance_wait" && bok.status === 200 && bnobody.status === 200,
    `15초 안 → ${bw.status} ${bw.body.code}, 15초 뒤 → ${bok.status}, 접속 중 대상 없음 → ${bnobody.status}`);
  await db.from("team_debates").update({ speaker_balance: false }).eq("id", D);

  // ── V-AC11 일시정지 ─────────────────────────────────────────────
  console.log("[V-AC11] 일시정지");
  await T.patch(base, { action: "pause" });
  const p0 = (await poll("팀가영")).body.turn.remainingMs;
  await sleep(3000);
  const p1 = (await poll("팀가영")).body.turn.remainingMs;
  const spPaused = await S["팀가영"].post("/api/team/speak", { debateId: D, content: "멈춤 중 발언" });
  const chPaused = await S["팀가영"].post("/api/team/chat", { debateId: D, content: "멈춘 동안 작전" });
  await T.patch(base, { action: "resume" });
  const p2 = (await poll("팀가영")).body.turn.remainingMs;
  check("V-AC11", Math.abs(p1 - p0) < 300 && Math.abs(p2 - p0) < 1000 && spPaused.status === 409 && chPaused.status === 200,
    `멈춤 직후 ${p0}ms, 3초 뒤 ${p1}ms, 재개 뒤 ${p2}ms, 멈춤 중 발언 ${spPaused.status}, 채팅 ${chPaused.status}`);

  // ── V-AC13 공지 ─────────────────────────────────────────────────
  console.log("[V-AC13] 공지");
  await T.post(`${base}/announce`, { content: "첫 번째 공지" });
  await T.post(`${base}/announce`, { content: "두 번째 공지" });
  r = await poll("팀라희");
  check("V-AC13", r.body.announcement?.content === "두 번째 공지" && r.body.messages.filter((m) => m.kind === "announcement").length === 2,
    `고정 공지 "${r.body.announcement?.content}", 기록 ${r.body.messages.filter((m) => m.kind === "announcement").length}건`);

  // ── V-AC14 숨김 ─────────────────────────────────────────────────
  console.log("[V-AC14] 숨김");
  t = await tpoll();
  const before = t.body.totals.pro;
  const hiddenScore = t.body.scores.find((s) => s.seq === (t.body.messages.find((m) => m.id === speechMsgId)?.seq));
  await T.patch(`${base}/messages/${speechMsgId}`, { hidden: true });
  const hiddenView = (await poll("팀라희")).body.messages.find((m) => m.id === speechMsgId);
  const tHidden = (await tpoll()).body.totals.pro;
  await T.patch(`${base}/messages/${speechMsgId}`, { hidden: false });
  const tBack = (await tpoll()).body.totals.pro;
  check("V-AC14", hiddenView?.hidden === true && hiddenView.content === null && tHidden === before - (hiddenScore?.total ?? 0) && tBack === before,
    `학생 내용 ${JSON.stringify(hiddenView?.content)}, 찬성 총점 ${before} → 숨김 ${tHidden} → 되돌림 ${tBack}`);

  // ── V-AC12 시간 끝 → 연장 ───────────────────────────────────────
  console.log("[V-AC9/12] 시간 끝·연장·단계 전환");
  await db.from("team_turns").update({ deadline_at: new Date(Date.now() + 3600e3).toISOString() }).eq("debate_id", D).is("ended_at", null);
  await age(D, 3600, { phaseOnly: true });
  r = await poll("팀가영");
  check("V-AC9-a", r.body.floorState === "time_up" && r.body.debate.phase === "claim", `단계 시간 끝 → ${r.body.floorState}, 단계 ${r.body.debate.phase}`);
  await T.patch(base, { action: "extend" });
  r = await poll("팀가영");
  check("V-AC12", r.body.floorState === "open" && r.body.debate.phaseRemainingMs > 58000 && r.body.debate.phaseRemainingMs <= 60000,
    `연장 뒤 ${r.body.floorState}, 단계 남은 ${r.body.debate.phaseRemainingMs}ms`);

  // V-AC9-b: 다음 단계 → 3초 안에 전원 반영
  await T.patch(base, { action: "next" });
  const tNext = Date.now();
  const seen = await Promise.all(players.map(async (n) => {
    for (;;) {
      const x = await poll(n);
      if (x.body.debate?.phase === "rebuttal") return Date.now() - tNext;
      if (Date.now() - tNext > 5000) return Infinity;
      await sleep(1500); // 학생 화면 폴링 간격
    }
  }));
  r = await poll("팀라희");
  check("V-AC9-b", Math.max(...seen) <= 3000 && r.body.turn?.side === "con", `6명 반영 최대 ${Math.max(...seen)}ms, 반론 첫 차례 ${r.body.turn?.side}`);

  // ── V-AC10 반론꺾기·최종 ─────────────────────────────────────────
  await T.patch(base, { action: "next" });
  const counterSide = (await poll("팀가영")).body.turn?.side;
  const say = async (n, text) => { await S[n].post("/api/team/claim", { debateId: D }); return S[n].post("/api/team/speak", { debateId: D, content: text }); };
  await say("팀가영", "반론꺾기: 비용은 잔반 처리비가 줄어서 괜찮아요.");
  await say("팀마루", "반론꺾기: 그래도 재료값이 더 들어요.");
  await T.patch(base, { action: "next" });
  const finalSide = (await poll("팀가영")).body.turn?.side;
  await say("팀바다", "최종: 비용을 생각해야 해요.");
  await say("팀다온", "최종: 맛있으면 건강해져요.");
  await say("팀라희", "최종: 영양이 먼저예요.");
  await say("팀나래", "최종: 잔반이 줄어요.");
  r = await poll("팀가영");
  check("V-AC10-b", counterSide === "pro" && finalSide === "con" && r.body.floorState === "final_done",
    `반론꺾기 첫 ${counterSide}, 최종 첫 ${finalSide}, 팀당 2회 뒤 토론방 ${r.body.floorState}`);

  // ── V-AC20 못 보낸 발언 (API 부분) ───────────────────────────────
  r = await S["팀나래"].post("/api/team/chat", { debateId: D, content: "보내지 못한 마지막 말", draft: true });
  const draftSeen = (await poll("팀다온")).body.messages.some((m) => m.kind === "draft" && m.content === "보내지 못한 마지막 말");
  check("V-AC20(API)", r.status === 200 && draftSeen, `못 보낸 발언 저장 ${r.status}, 팀원에게 보임 ${draftSeen} (화면 자동 저장은 브라우저 확인 필요)`);

  // ── V-AC22 채팅 속도 제한 ────────────────────────────────────────
  await sleep(2100);
  const q1 = await S["팀라희"].post("/api/team/chat", { debateId: D, content: "하나" });
  await sleep(1000);
  const q2 = await S["팀라희"].post("/api/team/chat", { debateId: D, content: "둘" });
  check("V-AC22", q1.status === 200 && q2.status === 429, `1초 간격 채팅 → ${q1.status}, ${q2.status}`);

  // ── V-AC33 부적절 발언 ──────────────────────────────────────────
  console.log("[V-AC33] 부적절 판정");
  await sleep(2100);
  const bad = await S["팀마루"].post("/api/team/chat", { debateId: D, content: "I will kill you, you worthless idiot. Go die." });
  let badAlert = null;
  for (let i = 0; i < 16 && !badAlert; i++) {
    await sleep(500);
    badAlert = (await tpoll()).body.alerts.find((a) => a.kind === "inappropriate");
  }
  const { data: badRow } = await db.from("team_messages").select("hidden_at").eq("id", bad.body.messageId).single();
  check("V-AC33", bad.status === 200 && !!badAlert && badAlert.name === "팀마루" && badRow.hidden_at === null,
    `저장 ${bad.status}, 알림 ${badAlert ? `${badAlert.name} "${badAlert.excerpt}"` : "없음"}, 자동 숨김 ${badRow.hidden_at ? "됨" : "안 됨"}`);

  // ── V-AC34 since ────────────────────────────────────────────────
  t = await tpoll();
  const tail = await tpoll(t.body.maxSeq);
  check("V-AC34", tail.body.messages.length === 0 && t.body.messages.length === t.body.maxSeq, `since=최대번호 → 새 메시지 ${tail.body.messages.length}건 (전체 ${t.body.messages.length}/${t.body.maxSeq})`);

  // ── V-AC25 공개 방식 ────────────────────────────────────────────
  r = await poll("팀가영");
  const hiddenScores = r.body.totals === null && r.body.scores === null;
  await db.from("team_debates").update({ score_visibility: "live" }).eq("id", D);
  r = await poll("팀가영");
  const liveScores = r.body.totals !== null && Array.isArray(r.body.scores);
  await db.from("team_debates").update({ score_visibility: "after_end" }).eq("id", D);
  await T.patch(`/api/classes/${cls.id}`, { gradeLevel: 6 });
  const g6 = (await T.post("/api/team-debates", { classId: cls.id, topic: "6학년 기본값" })).body.debate;
  await T.patch(`/api/classes/${cls.id}`, { gradeLevel: 4 });
  check("V-AC25", hiddenScores && liveScores && g6.score_visibility === "live",
    `4학년 after_end 응답 점수 ${hiddenScores ? "없음" : "있음"}, live 응답 점수 ${liveScores ? "있음" : "없음"}, 6학년 기본 ${g6.score_visibility}`);

  // ── V-AC26/27/28 채점 실패·수정·동시 ─────────────────────────────
  console.log("[V-AC26/27/28] 다시 채점·수정");
  for (let i = 0; i < 20; i++) { t = await tpoll(); if (t.body.totals.pendingCount === 0) break; await sleep(1000); }
  const done = t.body.scores.filter((s) => s.status === "done");
  const victim = done[done.length - 1];
  await db.from("team_speech_scores").update({ status: "failed", total: null, error: "강제 실패" }).eq("id", victim.scoreId);
  t = await tpoll();
  const failedShown = t.body.scores.find((s) => s.scoreId === victim.scoreId)?.status === "failed" && t.body.totals.failedCount >= 1;
  const [rt1, rt2] = await Promise.all([T.post(`${base}/scores/${victim.scoreId}/retry`), T.post(`${base}/scores/${victim.scoreId}/retry`)]);
  const { data: rescored } = await db.from("team_speech_scores").select("status, total, attempts").eq("id", victim.scoreId).single();
  check("V-AC26", failedShown && rescored.status === "done" && rescored.total !== null,
    `실패 표시 ${failedShown}, 다시 채점 뒤 ${rescored.status} ${rescored.total}점`);
  check("V-AC28-a", [rt1.status, rt2.status].sort().join(",") === "200,409" && rescored.attempts === 2,
    `동시 다시 채점 → ${rt1.status}, ${rt2.status}, 시도 횟수 ${rescored.attempts}`);

  const target = done[0];
  const totalsBefore = (await tpoll()).body.totals;
  const bad400 = await T.patch(`${base}/scores/${target.scoreId}`, { logic: 3, evidence: 1, response: 1, phaseFit: 1, attitude: 0 });
  const edit = await T.patch(`${base}/scores/${target.scoreId}`, { logic: 0, evidence: 0, response: 0, phaseFit: 0, attitude: 0 });
  const totalsAfter = (await tpoll()).body.totals;
  const retryEdited = await T.post(`${base}/scores/${target.scoreId}/retry`);
  const { data: edits } = await db.from("team_score_edits").select("id").eq("score_id", target.scoreId);
  const { data: kept } = await db.from("team_speech_scores").select("total").eq("id", target.scoreId).single();
  const msgSide = (await tpoll()).body.messages.find((m) => m.seq === target.seq)?.side;
  check("V-AC27", bad400.status === 400 && edit.status === 200 && totalsAfter[msgSide] === totalsBefore[msgSide] - target.total
    && edits.length === 1 && retryEdited.status === 409 && kept.total === 0,
    `범위 밖 ${bad400.status}, 수정 ${edit.status}, ${msgSide} 총점 ${totalsBefore[msgSide]}→${totalsAfter[msgSide]}, 이력 ${edits.length}건, 수정한 점수 다시 채점 ${retryEdited.status}, 유지 ${kept.total}`);

  // ── V-AC30 종료 → 결과 ──────────────────────────────────────────
  console.log("[V-AC30/31] 종료·결과");
  const tEnd = Date.now();
  const [e1, e2] = await Promise.all([T.patch(base, { action: "end" }), T.patch(base, { action: "end" })]);
  const endMs = Date.now() - tEnd;
  let rep = null;
  for (let i = 0; i < 60; i++) {
    rep = (await T.json(`${base}/report`)).body;
    if (rep.report && rep.report.status !== "pending") break;
    await sleep(1000);
  }
  const repMs = Date.now() - tEnd;
  const { count: reportRows } = await db.from("team_reports").select("id", { count: "exact", head: true }).eq("debate_id", D);
  check("V-AC30", endMs < 1000 && rep.report?.status === "done" && repMs <= 60000 && !!rep.report.feedback?.best?.pro?.point && rep.winner !== undefined,
    `종료 응답 ${endMs}ms, 결과 ${rep.report?.status} (${repMs}ms), 우승 ${rep.winner}, 총점 ${rep.totals?.pro}:${rep.totals?.con}`);
  check("V-AC28-b", [e1.status, e2.status].sort().join(",") === "200,409" && reportRows === 1, `동시 종료 → ${e1.status}, ${e2.status}, 결과 행 ${reportRows}개`);
  const expectWinner = rep.totals.pro !== rep.totals.con ? (rep.totals.pro > rep.totals.con ? "pro" : "con")
    : ((rep.totals.byStage.counter?.pro ?? 0) !== (rep.totals.byStage.counter?.con ?? 0)
      ? ((rep.totals.byStage.counter?.pro ?? 0) > (rep.totals.byStage.counter?.con ?? 0) ? "pro" : "con") : "draw");
  check("V-AC29(실데이터)", rep.winner === expectWinner, `서버 우승 ${rep.winner} = 규칙 계산 ${expectWinner}`);

  // V-AC31
  r = await S["팀가영"].json(`/api/team/result?debateId=${D}`);
  const preparing = r.body.status === "preparing" && r.body.teams === undefined;
  await T.patch(base, { action: "publish" });
  r = await S["팀가영"].json(`/api/team/result?debateId=${D}`);
  const keys = Object.keys(r.body).sort().join(",");
  const rawResult = JSON.stringify(r.body);
  const nameLeak = names.filter((n) => rawResult.includes(n));
  check("V-AC31", preparing && keys === "feedback,pendingCount,stageScores,teams,topic,winner" && nameLeak.length === 0 && !/speechCount|member_notes|alias/.test(rawResult),
    `공개 전 ${preparing ? "준비 중" : "노출됨"}, 공개 후 키 ${keys}, 이름 유출 ${nameLeak.length}건`);

  // ── V-AC32 PDF ──────────────────────────────────────────────────
  const pdfRes = await T.fetch(`${base}/export`);
  const pdf = Buffer.from(await pdfRes.arrayBuffer());
  check("V-AC32(API)", pdfRes.status === 200 && pdf.subarray(0, 5).toString() === "%PDF-" && pdf.length > 10000,
    `${pdfRes.status}, ${pdf.length}바이트 (본문 검사는 tests/team-pdf.test.ts)`);

  // ── V-AC4 (닫은 뒤) + 학생 비활성 ────────────────────────────────
  console.log("[V-AC4] 보관·삭제");
  const delStudent = await T.json(`/api/students/${sid["팀마루"]}`, { method: "DELETE" });
  const { data: maru } = await db.from("students").select("is_active").eq("id", sid["팀마루"]).single();
  const { count: maruMsgs } = await db.from("team_messages").select("id", { count: "exact", head: true }).eq("member_id", mid[sid["팀마루"]]);
  check("V-AC4-c", delStudent.status === 200 && maru?.is_active === false && maruMsgs > 0, `팀 토론만 한 학생 삭제 → ${delStudent.status}, 활성 ${maru?.is_active}, 발언 ${maruMsgs}건 유지`);
  const notArchived = await T.json(base, { method: "DELETE" });
  await T.patch(base, { action: "archive" });
  const preview = await T.json(`${base}?preview=1`, { method: "DELETE" });
  const del = await T.json(base, { method: "DELETE" });
  const { count: left } = await db.from("team_debates").select("id", { count: "exact", head: true }).eq("id", D);
  check("V-AC4-d", notArchived.status === 409 && preview.body.impact.speechCount > 0 && preview.body.impact.chatCount > 0
    && preview.body.impact.scoredCount > 0 && del.status === 200 && left === 0,
    `보관 전 삭제 ${notArchived.status}, 미리보기 발언 ${preview.body.impact.speechCount}·채팅 ${preview.body.impact.chatCount}·채점 ${preview.body.impact.scoredCount}, 삭제 ${del.status}`);

  // 결과
  console.log("\n" + "=".repeat(60));
  const pass = results.filter((x) => x.ok).length;
  console.log(`통과 ${pass} / ${results.length}`);
  const fails = results.filter((x) => !x.ok);
  if (fails.length) {
    console.log("\n실패:");
    for (const f of fails) console.log(`  - ${f.id}: ${f.detail}`);
  }
  await cleanup();
  console.log("\n검증 데이터 정리 완료");
  if (fails.length) process.exit(1);
}

main().catch(async (e) => {
  console.error("\nverify:team 오류:", e);
  await cleanup().catch(() => {});
  process.exit(1);
});
