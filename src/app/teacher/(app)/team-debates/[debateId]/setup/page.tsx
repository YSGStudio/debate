"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GRADE_LEVELS } from "@/lib/grade-presets";
import { assignmentWarnings, randomAssign } from "@/lib/team/assign";
import {
  PHASE_LABEL,
  STAGE_MINUTES_MAX,
  STAGE_MINUTES_MIN,
  STAGE_PHASES,
  TURN_SECONDS_MAX,
  TURN_SECONDS_MIN,
  type Side,
  type StagePhase,
} from "@/lib/team/rules";

type Column = Side | "none";

interface Debate {
  id: string; class_id: string; topic: string; description: string | null; grade_level: number;
  status: "draft" | "open" | "closed"; phase: string; pro_name: string; con_name: string;
  stage_seconds: Record<StagePhase, number>; turn_seconds: number;
  score_visibility: "live" | "after_end"; speaker_balance: boolean;
}
interface Loaded {
  debate: Debate;
  className: string;
  members: { studentId: string; side: Side; name: string }[];
  students: { id: string; name: string }[];
}

/** 팀 토론 설정·팀 배정 (ver2 V-R1~V-R4) */
export default function TeamSetupPage() {
  const { debateId } = useParams<{ debateId: string }>();
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [assign, setAssign] = useState<Record<string, Column>>({});
  const [form, setForm] = useState<Debate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/team-debates/${debateId}`, { cache: "no-store" });
    if (res.status === 404) { setError("찾을 수 없습니다."); return; }
    if (!res.ok) return;
    const body = (await res.json()) as Loaded;
    setData(body);
    setForm(body.debate);
    const a: Record<string, Column> = {};
    for (const s of body.students) a[s.id] = "none";
    for (const m of body.members) a[m.studentId] = m.side;
    setAssign(a);
  }, [debateId]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { if (alive) void load(); }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [load]);

  const counts = useMemo(() => {
    const v = Object.values(assign);
    return { pro: v.filter((x) => x === "pro").length, con: v.filter((x) => x === "con").length };
  }, [assign]);
  const warnings = assignmentWarnings(counts.pro, counts.con);

  if (error && !data) return <p className="text-red-700">{error}</p>;
  if (!data || !form) return <p className="text-gray-500">불러오는 중...</p>;

  const d = data.debate;
  const editable = d.status === "draft";
  const assignable = d.status === "draft" || (d.status === "open" && d.phase === "waiting");

  async function call(body: unknown, method = "PATCH", url = `/api/team-debates/${debateId}`) {
    setError(null); setNotice(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string; warnings?: string[] };
    if (!res.ok) { setError(json.error ?? "실패했습니다."); return null; }
    return json;
  }

  async function saveSettings() {
    const f = form!;
    const r = await call({
      action: "update",
      topic: f.topic,
      description: f.description || null,
      proName: f.pro_name,
      conName: f.con_name,
      stageMinutes: Object.fromEntries(STAGE_PHASES.map((p) => [p, f.stage_seconds[p] / 60])),
      turnSeconds: f.turn_seconds,
      scoreVisibility: f.score_visibility,
      speakerBalance: f.speaker_balance,
      gradeLevel: f.grade_level,
    });
    if (r) { setNotice("설정을 저장했습니다."); await load(); }
  }

  async function saveMembers() {
    const members = Object.entries(assign)
      .filter(([, side]) => side !== "none")
      .map(([studentId, side]) => ({ studentId, side }));
    const r = await call({ members }, "PUT", `/api/team-debates/${debateId}/members`);
    if (r) {
      setNotice(r.warnings?.length ? `저장했습니다. ${r.warnings.join(" ")}` : "팀 배정을 저장했습니다.");
      await load();
    }
  }

  function shuffle() {
    const r = randomAssign(data!.students.map((s) => s.id));
    const a: Record<string, Column> = {};
    for (const id of r.pro) a[id] = "pro";
    for (const id of r.con) a[id] = "con";
    setAssign(a);
  }

  const columns: { key: Column; title: string; tone: string }[] = [
    { key: "pro", title: `${form.pro_name} (찬성) ${counts.pro}명`, tone: "border-blue-300 bg-blue-50" },
    { key: "none", title: "미배정", tone: "border-gray-200 bg-gray-50" },
    { key: "con", title: `${form.con_name} (반대) ${counts.con}명`, tone: "border-orange-300 bg-orange-50" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">{data.className} · 팀 토론</p>
          <h1 className="text-xl font-bold">{d.topic}</h1>
        </div>
        <div className="flex gap-2">
          {d.status === "draft" && (
            <button
              onClick={async () => { const r = await call({ action: "open" }); if (r) router.push(`/teacher/team-debates/${debateId}`); }}
              className="rounded-xl bg-green-600 px-4 py-2 font-bold text-white"
            >
              입장 열기
            </button>
          )}
          {d.status !== "draft" && (
            <Link href={`/teacher/team-debates/${debateId}`} className="rounded-xl bg-green-600 px-4 py-2 font-bold text-white">
              관제실로
            </Link>
          )}
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      {notice && <p className="rounded-xl bg-green-50 px-4 py-3 text-green-800">{notice}</p>}

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="mb-3 font-bold">설정</h2>
        {!editable && <p className="mb-2 text-sm text-gray-500">입장을 연 뒤에는 설정을 바꿀 수 없습니다.</p>}
        <fieldset disabled={!editable} className="flex flex-col gap-2 text-sm">
          <input value={form.topic} maxLength={100} onChange={(e) => setForm({ ...form, topic: e.target.value })}
            className="rounded-xl border-2 border-gray-200 px-3 py-2" />
          <input value={form.description ?? ""} maxLength={300} placeholder="보충 설명 (선택)"
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="rounded-xl border-2 border-gray-200 px-3 py-2" />
          <div className="flex flex-wrap gap-3">
            <label>찬성 팀 이름 <input value={form.pro_name} maxLength={20} onChange={(e) => setForm({ ...form, pro_name: e.target.value })}
              className="w-28 rounded-lg border-2 border-gray-200 px-2 py-1" /></label>
            <label>반대 팀 이름 <input value={form.con_name} maxLength={20} onChange={(e) => setForm({ ...form, con_name: e.target.value })}
              className="w-28 rounded-lg border-2 border-gray-200 px-2 py-1" /></label>
            <label>학년 <select value={form.grade_level} onChange={(e) => setForm({ ...form, grade_level: Number(e.target.value) })}
              className="rounded-lg border-2 border-gray-200 px-2 py-1">
              {GRADE_LEVELS.map((g) => <option key={g} value={g}>{g}학년</option>)}
            </select></label>
          </div>
          <div className="flex flex-wrap gap-3">
            {STAGE_PHASES.map((p) => (
              <label key={p}>{PHASE_LABEL[p]}{" "}
                <input type="number" min={STAGE_MINUTES_MIN} max={STAGE_MINUTES_MAX} value={form.stage_seconds[p] / 60}
                  onChange={(e) => setForm({ ...form, stage_seconds: { ...form.stage_seconds, [p]: Number(e.target.value) * 60 } })}
                  className="w-16 rounded-lg border-2 border-gray-200 px-2 py-1" />분</label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label>발언 제한 <input type="number" min={TURN_SECONDS_MIN} max={TURN_SECONDS_MAX} value={form.turn_seconds}
              onChange={(e) => setForm({ ...form, turn_seconds: Number(e.target.value) })}
              className="w-20 rounded-lg border-2 border-gray-200 px-2 py-1" />초</label>
            <label>학생 점수 공개 <select value={form.score_visibility}
              onChange={(e) => setForm({ ...form, score_visibility: e.target.value as "live" | "after_end" })}
              className="rounded-lg border-2 border-gray-200 px-2 py-1">
              <option value="after_end">결과 공개 뒤에만</option>
              <option value="live">토론 중 실시간</option>
            </select></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.speaker_balance}
              onChange={(e) => setForm({ ...form, speaker_balance: e.target.checked })} />발언자 고르게</label>
          </div>
          <button onClick={saveSettings} className="self-start rounded-xl bg-blue-600 px-5 py-2 font-bold text-white disabled:bg-gray-300">
            설정 저장
          </button>
        </fieldset>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">팀 배정</h2>
          <div className="flex gap-2">
            <button onClick={shuffle} disabled={!assignable} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">
              🎲 무작위 배정
            </button>
            <button onClick={saveMembers} disabled={!assignable}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white disabled:bg-gray-300">
              배정 저장
            </button>
          </div>
        </div>
        {!assignable && <p className="mb-2 text-sm text-gray-500">토론을 시작한 뒤에는 팀을 바꿀 수 없습니다.</p>}
        {warnings.map((w) => (
          <p key={w} className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">⚠️ {w}</p>
        ))}
        <div className="grid gap-3 md:grid-cols-3">
          {columns.map((col) => (
            <div
              key={col.key}
              onDragOver={(e) => { if (assignable) e.preventDefault(); }}
              onDrop={() => { if (dragging && assignable) setAssign((a) => ({ ...a, [dragging]: col.key })); setDragging(null); }}
              className={`min-h-40 rounded-xl border-2 p-3 ${col.tone}`}
            >
              <p className="mb-2 text-sm font-bold">{col.title}</p>
              <ul className="flex flex-col gap-1">
                {data.students.filter((s) => (assign[s.id] ?? "none") === col.key).map((s) => (
                  <li
                    key={s.id}
                    draggable={assignable}
                    onDragStart={() => setDragging(s.id)}
                    className="flex items-center justify-between rounded-lg bg-white px-2 py-1 text-sm shadow-sm"
                  >
                    <span>{s.name}</span>
                    {assignable && (
                      <span className="flex gap-1">
                        {(["pro", "none", "con"] as Column[]).filter((c) => c !== col.key).map((c) => (
                          <button key={c} onClick={() => setAssign((a) => ({ ...a, [s.id]: c }))}
                            className="rounded border px-1 text-xs text-gray-600"
                            aria-label={`${s.name}을(를) ${c === "pro" ? "찬성" : c === "con" ? "반대" : "미배정"}으로`}>
                            {c === "pro" ? "찬" : c === "con" ? "반" : "빼기"}
                          </button>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <Link href={`/teacher/classes/${d.class_id}`} className="text-sm text-gray-500 underline">← 토론으로</Link>
    </div>
  );
}
