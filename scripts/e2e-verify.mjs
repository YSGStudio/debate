/**
 * 실제 Supabase 를 쓰는 E2E 검증 (PRD Verification - Agent 10번).
 *
 *   npm run dev            # 다른 터미널에서
 *   npm run verify:e2e
 *
 * 주의: 연결된 Supabase 프로젝트에 실제로 데이터를 쓰고 지운다.
 * 만드는 것은 `e2e-` 로 시작하는 교사 계정, `E2E` 로 시작하는 초대 코드,
 * "검증 4학년 2반" 학급과 그 하위 데이터뿐이며 끝나면 모두 지운다.
 * 운영 데이터가 들어 있는 프로젝트에서는 돌리지 말 것.
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

/** 쿠키를 들고 다니는 최소 클라이언트 */
function makeAgent() {
  const jar = new Map();
  return {
    cookieNames: () => [...jar.keys()],
    raw: (name) => jar.get(name),
    async fetch(path, init = {}) {
      const headers = new Headers(init.headers ?? {});
      if (jar.size > 0) {
        headers.set("cookie", [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "));
      }
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
      for (const [k, v] of res.headers) {
        if (k.toLowerCase() !== "set-cookie") continue;
        const [pair] = v.split(";");
        const idx = pair.indexOf("=");
        jar.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
      const sc = res.headers.getSetCookie?.() ?? [];
      for (const c of sc) {
        const [pair] = c.split(";");
        const idx = pair.indexOf("=");
        jar.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
      return res;
    },
  };
}

const stamp = Date.now();
const TEACHER_A = { email: `e2e-a-${stamp}@example.com`, password: "e2e-password-1234", name: "검증 선생 A" };
const TEACHER_B = { email: `e2e-b-${stamp}@example.com`, password: "e2e-password-1234", name: "검증 선생 B" };
const INVITE = `E2E${stamp}`;

async function cleanup() {
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  for (const u of users?.users ?? []) {
    if (u.email?.startsWith("e2e-")) {
      await db.from("teachers").delete().eq("id", u.id);
      await db.auth.admin.deleteUser(u.id);
    }
  }
  await db.from("invite_codes").delete().like("code", "E2E%");
}

async function main() {
  console.log(`대상: ${BASE}\n`);
  await cleanup();

  // 초대 코드 2회분
  await db.from("invite_codes").insert({ code: INVITE, note: "e2e", max_uses: 2, is_active: true });

  const a = makeAgent();
  const b = makeAgent();

  // ── AC1: 초대 코드 ────────────────────────────────────────────────
  console.log("[AC1] 초대 코드");
  let res = await a.fetch("/api/teacher/signup", {
    method: "POST",
    body: JSON.stringify({ ...TEACHER_A, inviteCode: "NOPE-WRONG" }),
  });
  let body = await res.json().catch(() => ({}));
  const { count: afterBad } = await db
    .from("teachers")
    .select("*", { count: "exact", head: true })
    .eq("email", TEACHER_A.email);
  check("AC1-a", res.status === 403 && afterBad === 0, `틀린 코드 → ${res.status} "${body.error}", 계정 ${afterBad}건`);

  res = await a.fetch("/api/teacher/signup", { method: "POST", body: JSON.stringify({ ...TEACHER_A, inviteCode: INVITE }) });
  check("AC1-b", res.status === 200, `올바른 코드 → ${res.status}`);

  await b.fetch("/api/teacher/signup", { method: "POST", body: JSON.stringify({ ...TEACHER_B, inviteCode: INVITE }) });
  const third = await makeAgent().fetch("/api/teacher/signup", {
    method: "POST",
    body: JSON.stringify({ email: `e2e-c-${stamp}@example.com`, password: "e2e-password-1234", name: "C", inviteCode: INVITE }),
  });
  const tbody = await third.json().catch(() => ({}));
  check("AC1-c", third.status === 403, `max_uses=2 소진 후 3번째 → ${third.status} "${tbody.error}"`);

  // ── AC2: 접근 보호와 소유권 ──────────────────────────────────────
  console.log("[AC2] 접근 보호");
  const anon = makeAgent();
  res = await anon.fetch("/teacher");
  const loc = res.headers.get("location") ?? "";
  check("AC2-a", res.status >= 300 && res.status < 400 && loc.includes("/teacher/login"), `비로그인 /teacher → ${res.status} ${loc}`);

  // ── AC3: 학급 + 명단 ─────────────────────────────────────────────
  console.log("[AC3] 학급과 명단");
  res = await a.fetch("/api/classes", { method: "POST", body: JSON.stringify({ name: "검증 4학년 2반", gradeLevel: 4 }) });
  const cls = (await res.json()).class;
  check("AC3-a", /^[A-Z0-9]{6}$/.test(cls.join_code) && !/[01OIL]/.test(cls.join_code), `학급 코드 ${cls.join_code}`);
  check("AC19", cls.grade_level === 4, `학년 기본값 ${cls.grade_level}`);

  const names = Array.from({ length: 25 }, (_, i) => `검증학생${String(i + 1).padStart(2, "0")}`);
  res = await a.fetch(`/api/classes/${cls.id}/students`, { method: "POST", body: JSON.stringify({ mode: "bulk", raw: names.join("\n") }) });
  body = await res.json();
  check("AC3-b", res.status === 200 && body.added === 25, `25명 일괄 등록 → ${res.status}, added=${body.added}`);

  res = await a.fetch(`/api/classes/${cls.id}/students`, { method: "POST", body: JSON.stringify({ mode: "bulk", raw: "검증학생01\n새이름" }) });
  body = await res.json();
  check("AC3-c", res.status === 409 && body.duplicates?.includes("검증학생01"), `이미 있는 이름 → ${res.status}, duplicates=${JSON.stringify(body.duplicates)}`);

  res = await a.fetch("/api/classes", { method: "POST", body: JSON.stringify({ name: "잘못된 학년", gradeLevel: 2 }) });
  check("AC19-b", res.status === 400, `학년 2 → ${res.status}`);

  // 남의 학급 접근
  res = await b.fetch(`/api/classes/${cls.id}`);
  check("AC2-b", res.status === 404, `교사 B 가 교사 A 의 학급 → ${res.status}`);

  // ── AC4: 단일 활성 세션 ──────────────────────────────────────────
  console.log("[AC4] 단일 활성 세션");
  const mk = async (topic, limit = 30) => {
    const r = await a.fetch("/api/sessions", { method: "POST", body: JSON.stringify({ classId: cls.id, topic, messageLimit: limit }) });
    return (await r.json()).session;
  };
  const s1 = await mk("숙제는 없어져야 한다");
  const s2 = await mk("초등학생도 휴대폰을 가져야 한다");
  check("AC21-a", s1.grade_level === 4, `세션이 학급 학년 스냅샷 → ${s1.grade_level}`);

  res = await a.fetch(`/api/sessions/${s1.id}`, { method: "PATCH", body: JSON.stringify({ action: "open" }) });
  check("AC4-a", res.status === 200, `첫 토론 시작 → ${res.status}`);
  res = await a.fetch(`/api/sessions/${s2.id}`, { method: "PATCH", body: JSON.stringify({ action: "open" }) });
  body = await res.json();
  check("AC4-b", res.status === 409 && body.openTopic === s1.topic, `옵션 켠 상태 두 번째 → ${res.status} openTopic="${body.openTopic}"`);

  await a.fetch(`/api/classes/${cls.id}`, { method: "PATCH", body: JSON.stringify({ singleActiveSession: false }) });
  res = await a.fetch(`/api/sessions/${s2.id}`, { method: "PATCH", body: JSON.stringify({ action: "open" }) });
  check("AC4-c", res.status === 200, `옵션 끈 뒤 두 번째 → ${res.status}`);
  await a.fetch(`/api/sessions/${s2.id}`, { method: "PATCH", body: JSON.stringify({ action: "close" }) });
  await a.fetch(`/api/classes/${cls.id}`, { method: "PATCH", body: JSON.stringify({ singleActiveSession: true }) });

  // ── AC21: 학급 학년 변경이 기존 세션에 영향 없음 ──────────────────
  console.log("[AC21] 학년 스냅샷");
  await a.fetch(`/api/classes/${cls.id}`, { method: "PATCH", body: JSON.stringify({ gradeLevel: 6 }) });
  const { data: after } = await db.from("debate_sessions").select("grade_level").eq("id", s1.id).single();
  check("AC21-b", after.grade_level === 4, `학급을 6학년으로 바꾼 뒤 진행 중 세션 학년 = ${after.grade_level}`);
  const s3 = await mk("학년 변경 후 만든 토론");
  check("AC21-c", s3.grade_level === 6, `그 뒤 새로 만든 세션 학년 = ${s3.grade_level}`);
  await a.fetch(`/api/classes/${cls.id}`, { method: "PATCH", body: JSON.stringify({ gradeLevel: 4 }) });

  // ── AC5, AC6: 학생 입장 ──────────────────────────────────────────
  console.log("[AC5/AC6] 학생 입장");
  const st = makeAgent();
  res = await st.fetch("/api/join/lookup", { method: "POST", body: JSON.stringify({ code: cls.join_code }) });
  const lookup = await res.json();
  check("AC5-a", res.status === 200 && lookup.students.length === 25, `코드 조회 → 명단 ${lookup.students?.length}명`);

  res = await st.fetch("/api/join/lookup", { method: "POST", body: JSON.stringify({ code: "ZZZZZZ" }) });
  check("AC5-b", res.status === 404, `틀린 코드 → ${res.status}`);

  const me = lookup.students[0];
  res = await st.fetch("/api/join/enter", { method: "POST", body: JSON.stringify({ code: cls.join_code, studentId: me.id }) });
  check("AC5-c", res.status === 200 && st.cookieNames().includes("ss_token"), `이름 선택 → 쿠키 ${st.cookieNames().join(",")}`);

  // 찬반 없이는 메시지를 보낼 수 없다
  res = await st.fetch("/api/debate/message", { method: "POST", body: JSON.stringify({ sessionId: s1.id, content: "찬반 없이 보냄" }) });
  body = await res.json().catch(() => ({}));
  check("AC5-d", res.status === 409, `찬반 미선택 상태 전송 → ${res.status} "${body.error}"`);

  res = await st.fetch("/api/debate/join", { method: "POST", body: JSON.stringify({ sessionId: s1.id, stance: "pro" }) });
  const part = (await res.json()).participation;
  check("AC5-e", res.status === 200 && part.stance === "pro", `찬성 선택 → ${part?.stance}`);

  // 재입장 시 상태 복원
  res = await st.fetch(`/api/debate/state?sessionId=${s1.id}`);
  const state1 = await res.json();
  check("AC6", state1.participation?.stance === "pro" && state1.session?.id === s1.id, `재조회 → 입장 ${state1.participation?.stance}, 잠금 ${state1.locked}`);

  // 위조 쿠키는 거부
  const forged = makeAgent();
  await forged.fetch("/api/join/enter", { method: "POST", body: JSON.stringify({ code: cls.join_code, studentId: me.id }) });
  const good = forged.raw("ss_token");
  const tampered = good.slice(0, -3) + "AAA";
  res = await fetch(BASE + "/api/debate/state", { headers: { cookie: `ss_token=${tampered}` } });
  check("보안-쿠키", res.status === 401, `서명 변조 쿠키 → ${res.status}`);

  // ── AC17: rate limit ─────────────────────────────────────────────
  console.log("[AC17] 전송 속도 제한");
  const r1 = await st.fetch("/api/debate/message", { method: "POST", body: JSON.stringify({ sessionId: s1.id, content: "첫 번째 생각이에요" }) });
  await r1.text().catch(() => {});
  const r2 = await st.fetch("/api/debate/message", { method: "POST", body: JSON.stringify({ sessionId: s1.id, content: "바로 또 보냄" }) });
  check("AC17", r2.status === 429, `1초 내 재전송 → ${r2.status} (첫 요청 ${r1.status})`);

  // ── AC11/AC12: 판정 저장 ─────────────────────────────────────────
  console.log("[AC11/AC12] 판정 (OpenAI 필요)");
  await new Promise((r) => setTimeout(r, 6000));
  const off = await st.fetch("/api/debate/message", { method: "POST", body: JSON.stringify({ sessionId: s1.id, content: "오늘 급식 뭐야?" }) });
  await off.text().catch(() => {});
  await new Promise((r) => setTimeout(r, 8000));
  const { data: flags } = await db.from("moderation_flags").select("verdict, triage_failed, reason").eq("participation_id", part.id);
  const verdicts = (flags ?? []).map((f) => `${f.verdict}${f.triage_failed ? "(실패)" : ""}`);
  const anyReal = (flags ?? []).some((f) => !f.triage_failed);
  check("AC11/12", anyReal, `판정 ${flags?.length ?? 0}건: ${verdicts.join(", ") || "없음"}${anyReal ? "" : " ← 모델 호출 불가로 판정 품질 미확인"}`);

  // ── AC14/AC15: 대시보드 ──────────────────────────────────────────
  console.log("[AC14/AC15] 대시보드");
  res = await a.fetch(`/api/sessions/${s1.id}/dashboard`);
  const snap = await res.json();
  const tile = snap.students?.find((s) => s.student_id === me.id);
  check("AC14-a", res.status === 200 && snap.students.length === 25, `타일 ${snap.students?.length}개, 참여 ${snap.summary?.joinedStudents}명`);
  check("AC14-b", tile?.message_count >= 1, `본인 타일 발언 ${tile?.message_count}회, 입장 ${tile?.stance}`);
  check("AC26-a", snap.summary?.averageTotal !== undefined, `대시보드에 반 평균 필드 존재 (${snap.summary?.averageTotal})`);

  res = await b.fetch(`/api/sessions/${s1.id}/dashboard`);
  check("AC2-c", res.status === 404, `교사 B 가 교사 A 의 대시보드 → ${res.status}`);

  res = await a.fetch(`/api/sessions/${s1.id}/participations/${part.id}`);
  const detail = await res.json();
  check("AC14-c", res.status === 200 && Array.isArray(detail.messages), `상세 대화 ${detail.messages?.length}건`);

  // 경고 확인 처리
  const { data: badFlag } = await db.from("moderation_flags").select("id").eq("participation_id", part.id).limit(1).maybeSingle();
  if (badFlag) {
    res = await a.fetch(`/api/flags/${badFlag.id}/acknowledge`, { method: "POST", body: JSON.stringify({ sessionId: s1.id }) });
    const { data: ackd } = await db.from("moderation_flags").select("acknowledged_at").eq("id", badFlag.id).single();
    check("AC15", res.status === 200 && ackd.acknowledged_at !== null, `확인 처리 → ${res.status}, acknowledged_at 기록됨`);
  } else {
    check("AC15", false, "판정 행이 없어 확인 처리 미검증");
  }

  // ── AC9: 메시지 상한 ─────────────────────────────────────────────
  console.log("[AC9] 메시지 상한");
  const sLimit = await mk("상한 검증용 토론", 3);
  await a.fetch(`/api/sessions/${s1.id}`, { method: "PATCH", body: JSON.stringify({ action: "close" }) });
  await a.fetch(`/api/sessions/${sLimit.id}`, { method: "PATCH", body: JSON.stringify({ action: "open" }) });

  const st2 = makeAgent();
  await st2.fetch("/api/join/enter", { method: "POST", body: JSON.stringify({ code: cls.join_code, studentId: lookup.students[1].id }) });
  await st2.fetch("/api/debate/join", { method: "POST", body: JSON.stringify({ sessionId: sLimit.id, stance: "con" }) });

  let sent = 0;
  for (let i = 0; i < 4; i++) {
    const r = await st2.fetch("/api/debate/message", { method: "POST", body: JSON.stringify({ sessionId: sLimit.id, content: `${i + 1}번째 생각이에요` }) });
    if (r.ok) { await r.text().catch(() => {}); sent++; } else {
      const bd = await r.json().catch(() => ({}));
      if (r.status === 409 && bd.lockReason === "limit") { check("AC9", sent === 3, `${sent}건 전송 후 4번째 → 409 lockReason=limit`); break; }
      if (r.status === 429) { await new Promise((x) => setTimeout(x, 6000)); i--; continue; }
      check("AC9", false, `예상 못한 응답 ${r.status} ${JSON.stringify(bd).slice(0, 80)}`);
      break;
    }
    await new Promise((x) => setTimeout(x, 6000));
  }

  // ── AC10: 세션 종료가 학생을 잠근다 ──────────────────────────────
  console.log("[AC10] 세션 종료");
  const sClose = await mk("종료 검증용 토론");
  await a.fetch(`/api/sessions/${sLimit.id}`, { method: "PATCH", body: JSON.stringify({ action: "close" }) });
  await a.fetch(`/api/sessions/${sClose.id}`, { method: "PATCH", body: JSON.stringify({ action: "open" }) });

  const st3 = makeAgent();
  await st3.fetch("/api/join/enter", { method: "POST", body: JSON.stringify({ code: cls.join_code, studentId: lookup.students[2].id }) });
  await st3.fetch("/api/debate/join", { method: "POST", body: JSON.stringify({ sessionId: sClose.id, stance: "pro" }) });

  await a.fetch(`/api/sessions/${sClose.id}`, { method: "PATCH", body: JSON.stringify({ action: "close" }) });
  res = await st3.fetch(`/api/debate/state?sessionId=${sClose.id}`);
  const closedState = await res.json();
  const blocked = await st3.fetch("/api/debate/message", { method: "POST", body: JSON.stringify({ sessionId: sClose.id, content: "종료 후 전송" }) });
  const bb = await blocked.json().catch(() => ({}));
  check("AC10", closedState.locked === true && closedState.lockReason === "closed" && blocked.status === 409,
    `상태 locked=${closedState.locked}/${closedState.lockReason}, 전송 → ${blocked.status} "${bb.error}"`);

  // ── AC23/AC26: 채점 건너뜀 + 학생 응답 격리 ──────────────────────
  console.log("[AC23/AC26] 채점과 정보 격리");
  await new Promise((r) => setTimeout(r, 3000));
  const { data: sc } = await db.from("debate_scores").select("status, total").eq("participation_id",
    (await db.from("participations").select("id").eq("session_id", sClose.id).limit(1).single()).data.id).maybeSingle();
  check("AC23", sc?.status === "skipped", `메시지 0건 참여의 채점 상태 = ${sc?.status ?? "행 없음"}`);

  res = await st3.fetch(`/api/debate/result?sessionId=${sClose.id}`);
  const raw = await res.text();
  const keys = Object.keys(JSON.parse(raw)).sort();
  const leaked = ["average", "Average", "평균", "등수", "rank", "students"].filter((k) => raw.includes(k));
  check("AC26-b", res.status === 200 && leaked.length === 0, `학생 응답 키=${JSON.stringify(keys)}, 유출 단어 ${leaked.length}건`);

  // ── AC16: PDF ────────────────────────────────────────────────────
  console.log("[AC16] PDF");
  res = await a.fetch(`/api/sessions/${s1.id}/export`);
  const buf = Buffer.from(await res.arrayBuffer());
  check("AC16", res.status === 200 && buf.subarray(0, 5).toString() === "%PDF-" && buf.length > 10000,
    `${res.status}, ${buf.length}바이트, ${res.headers.get("content-type")}`);

  // 결과
  console.log("\n" + "=".repeat(60));
  const pass = results.filter((r) => r.ok).length;
  console.log(`통과 ${pass} / ${results.length}`);
  const fails = results.filter((r) => !r.ok);
  if (fails.length) {
    console.log("\n실패:");
    for (const f of fails) console.log(`  - ${f.id}: ${f.detail}`);
  }

  await cleanup();
  await db.from("classes").delete().eq("id", cls.id);
  console.log("\n검증 데이터 정리 완료");
}

main().catch(async (e) => {
  console.error("\nE2E 오류:", e);
  await cleanup().catch(() => {});
  process.exit(1);
});
