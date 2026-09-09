/**
 * 길잡이 안내 검증 (실제 OpenAI + Supabase).
 *
 *   npm run dev            # 다른 터미널에서
 *   npm run verify:coach
 *
 * 세 가지 상황(근거 있는 답변 / 근거 없는 단답 / 주제 이탈)에서 안내가
 * 제대로 뜨는지, 판정과 안내가 어긋나지 않는지 확인한다.
 *
 * 주의: 연결된 Supabase 에 실제로 데이터를 쓰고 지운다.
 * `coach-` 로 시작하는 교사 계정과 검증용 학급만 만들었다 끝나면 지운다.
 * 운영 데이터가 들어 있는 프로젝트에서는 돌리지 말 것.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE = "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
const check = (id, ok, detail) => { results.push({ id, ok }); console.log(`${ok ? "  O" : "  X"} ${id}  ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RATE_GAP = 5300;

function agent() {
  const jar = new Map();
  return {
    async fetch(path, init = {}) {
      const headers = new Headers(init.headers ?? {});
      if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [p] = c.split(";"); const i = p.indexOf("=");
        jar.set(p.slice(0, i), p.slice(i + 1));
      }
      return res;
    },
  };
}

async function send(a, sessionId, content, retries = 3) {
  let res = await a.fetch("/api/debate/message", { method: "POST", body: JSON.stringify({ sessionId, content }) });
  while (res.status === 429 && retries-- > 0) {
    await sleep(RATE_GAP);
    res = await a.fetch("/api/debate/message", { method: "POST", body: JSON.stringify({ sessionId, content }) });
  }
  if (!res.ok) return { ok: false, status: res.status };
  await res.text();
  return { ok: true };
}

/** 상태 API 를 폴링해 길잡이 안내가 붙을 때까지 기다린다 (학생 화면과 같은 경로) */
async function waitCoach(a, sessionId, ms = 12000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const res = await a.fetch(`/api/debate/state?sessionId=${sessionId}`);
    if (res.ok) {
      const body = await res.json();
      if (body.coach && body.coach.kind !== "none") return body.coach;
    }
    await sleep(900);
  }
  return null;
}

const stamp = Date.now();
const INVITE = `CO${stamp}`;

async function cleanup() {
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  for (const u of users?.users ?? []) {
    if (u.email?.startsWith("coach-")) {
      await db.from("teachers").delete().eq("id", u.id);
      await db.auth.admin.deleteUser(u.id);
    }
  }
  await db.from("invite_codes").delete().like("code", "CO%");
}

async function main() {
  await cleanup();
  await db.from("invite_codes").insert({ code: INVITE, max_uses: 3, is_active: true, note: "길잡이 검증" });

  const t = agent();
  await t.fetch("/api/teacher/signup", {
    method: "POST",
    body: JSON.stringify({ email: `coach-${stamp}@example.com`, password: "coach-check-1234", name: "길잡이 검증", inviteCode: INVITE }),
  });

  let r = await t.fetch("/api/classes", { method: "POST", body: JSON.stringify({ name: "길잡이검증 학급", gradeLevel: 4 }) });
  const cls = (await r.json()).class;
  await t.fetch(`/api/classes/${cls.id}/students`, { method: "POST", body: JSON.stringify({ mode: "bulk", raw: "가검증\n나검증\n다검증\n라검증" }) });
  r = await t.fetch("/api/sessions", { method: "POST", body: JSON.stringify({ classId: cls.id, topic: "숙제는 없어져야 한다", messageLimit: 20 }) });
  const sess = (await r.json()).session;
  await t.fetch(`/api/sessions/${sess.id}`, { method: "PATCH", body: JSON.stringify({ action: "open" }) });
  r = await t.fetch("/api/join/lookup", { method: "POST", body: JSON.stringify({ code: cls.join_code }) });
  const students = (await r.json()).students;

  async function enter(idx, stance = "pro") {
    const a = agent();
    await a.fetch("/api/join/enter", { method: "POST", body: JSON.stringify({ code: cls.join_code, studentId: students[idx].id }) });
    await a.fetch("/api/debate/join", { method: "POST", body: JSON.stringify({ sessionId: sess.id, stance }) });
    const o = await a.fetch("/api/debate/opening", { method: "POST", body: JSON.stringify({ sessionId: sess.id }) });
    if (o.ok) await o.text();
    await sleep(RATE_GAP);
    return a;
  }

  const cases = [
    { idx: 0, text: "숙제가 많으면 잘 시간이 부족해서 다음 날 수업에 집중하기 어렵기 때문이에요.", want: "praise", label: "근거 있는 답변" },
    { idx: 1, text: "그냥요.", want: "need_reason", label: "근거 없는 단답" },
    { idx: 2, text: "오늘 급식에 돈가스 나왔으면 좋겠어요.", want: "off_topic", label: "주제 이탈" },
  ];

  for (const c of cases) {
    const a = await enter(c.idx);
    const sent = await send(a, sess.id, c.text);
    if (!sent.ok) { check(c.label, false, `전송 실패 ${sent.status}`); continue; }
    const coach = await waitCoach(a, sess.id);
    check(c.label, coach?.kind === c.want,
      coach ? `kind=${coach.kind} (기대 ${c.want}) — "${coach.message}"` : `안내 없음 (기대 ${c.want})`);
  }

  // 부적절 발언에는 길잡이가 조용히 있어야 한다
  const bad = await enter(3);
  await send(bad, sess.id, "야 이 바보 멍청이 똥개야");
  await sleep(9000);
  const badState = await (await bad.fetch(`/api/debate/state?sessionId=${sess.id}`)).json();
  check("부적절 발언엔 침묵", !badState.coach || badState.coach.kind === "none",
    `coach=${badState.coach ? badState.coach.kind : "없음"}`);

  // 판정 결과와 안내가 어긋나지 않는지 DB 로 대조
  const { data: flags } = await db
    .from("moderation_flags")
    .select("verdict, coach_kind, coach_message, messages(content)")
    .in("participation_id",
      ((await db.from("participations").select("id").eq("session_id", sess.id)).data ?? []).map((p) => p.id));

  console.log("\n  저장된 판정 ↔ 안내");
  let consistent = true;
  for (const f of flags ?? []) {
    const line = `    ${String(f.verdict).padEnd(14)} → ${String(f.coach_kind).padEnd(12)} "${(f.messages?.content ?? "").slice(0, 24)}"`;
    console.log(line);
    if (f.verdict === "off_topic" && f.coach_kind !== "off_topic") consistent = false;
    if (f.verdict === "inappropriate" && f.coach_kind !== "none") consistent = false;
    if (f.verdict === "on_topic" && f.coach_kind === "off_topic") consistent = false;
  }
  check("판정과 안내 일치", consistent, "이탈→이탈, 부적절→침묵, 정상→이탈 아님");

  console.log("\n" + "=".repeat(52));
  console.log(`통과 ${results.filter((x) => x.ok).length} / ${results.length}`);

  await db.from("classes").delete().eq("id", cls.id);
  await cleanup();
}

main().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
