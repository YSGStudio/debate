"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ATTITUDE_MIN, JUDGE_LABEL, JUDGE_MAX } from "@/lib/prompts/team-judge-guide";
import { FLOOR_PHASES, PHASE_LABEL, type Side, type TeamPhase } from "@/lib/team/rules";

interface FloorItem {
  id: string; seq: number; phase: TeamPhase; kind: string; side: Side | null; author: string | null;
  content: string; hidden: boolean;
  score: {
    id: string; status: string; total: number | null; logic: number | null; evidence: number | null;
    response: number | null; phaseFit: number | null; attitude: number | null; reason: string | null;
    respondedToSeq: number | null; edited: boolean;
  } | null;
}
interface Report {
  className: string;
  debate: { id: string; topic: string; grade_level: number; pro_name: string; con_name: string; status: string; results_published_at: string | null; class_id: string };
  totals: { pro: number; con: number; byStage: Partial<Record<TeamPhase, Record<Side, number>>>; pendingCount: number; failedCount: number };
  winner: Side | "draw" | null;
  report: { status: string; error: string | null; feedback: { best: Record<Side, { point: string; why: string }>; missed: string[]; suggestions: string[] } | null } | null;
  members: { id: string; name: string; side: Side; speechCount: number; note: string | null }[];
  floor: FloorItem[];
  penalties: { side: Side; phase: TeamPhase; points: number; reason: string }[];
  edits: { scoreId: string; before: Record<string, unknown>; after: Record<string, unknown>; at: string }[];
}

type Parts = { logic: number; evidence: number; response: number; phaseFit: number; attitude: number };
const KEYS: (keyof Parts)[] = ["logic", "evidence", "response", "phaseFit", "attitude"];
const RANGE: Record<keyof Parts, [number, number]> = {
  logic: [0, JUDGE_MAX.logic], evidence: [0, JUDGE_MAX.evidence], response: [0, JUDGE_MAX.response],
  phaseFit: [0, JUDGE_MAX.phaseFit], attitude: [ATTITUDE_MIN, 0],
};

/** 결과 보고서 (ver2 V-R36, V-R40~V-R45) */
export default function TeamReportPage() {
  const { debateId } = useParams<{ debateId: string }>();
  const [data, setData] = useState<Report | null>(null);
  const [editing, setEditing] = useState<{ scoreId: string; parts: Parts } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/team-debates/${debateId}/report`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, [debateId]);

  // 결과가 만들어지는 동안에는 몇 초마다 다시 본다
  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) void load(); };
    const first = setTimeout(tick, 0);
    const timer = setInterval(() => {
      if (data && data.report && data.report.status !== "pending") return;
      tick();
    }, 3000);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); };
  }, [load, data]);

  if (!data) return <p className="text-gray-500">불러오는 중...</p>;

  const n: Record<Side, string> = { pro: data.debate.pro_name, con: data.debate.con_name };
  const base = `/api/team-debates/${debateId}`;
  const status = data.report?.status ?? null;
  const edited = new Map<string, number>();
  for (const e of data.edits) edited.set(e.scoreId, (edited.get(e.scoreId) ?? 0) + 1);

  async function call(url: string, body?: unknown, method = "POST") {
    setMsg(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setMsg(json.error ?? "처리하지 못했어요."); return false; }
    await load();
    return true;
  }

  const headline =
    data.winner === null ? "발언이 없어 결과가 없어요" : data.winner === "draw" ? "무승부" : `${n[data.winner]} 우승`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">{data.className} · 초등 {data.debate.grade_level}학년 · 팀 토론 결과</p>
          <h1 className="text-xl font-bold">{data.debate.topic}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.debate.results_published_at ? (
            <span className="rounded-lg bg-green-100 px-3 py-2 text-sm font-bold text-green-800">학생에게 공개됨</span>
          ) : (
            <button onClick={() => call(base, { action: "publish" }, "PATCH")} disabled={data.debate.status !== "closed"}
              className="rounded-lg bg-green-600 px-4 py-2 font-bold text-white disabled:bg-gray-300">결과 공개</button>
          )}
          <a href={`${base}/export`} className="rounded-lg border px-4 py-2">PDF 내려받기</a>
          <Link href={`/teacher/team-debates/${debateId}`} className="rounded-lg border px-4 py-2">관제실</Link>
        </div>
      </div>

      {msg && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{msg}</p>}

      <section className="rounded-2xl border bg-white p-5">
        <p className="text-2xl font-bold">🏆 {headline}</p>
        <p className="mt-1 text-lg">{n.pro} {data.totals.pro} : {data.totals.con} {n.con}</p>
        <table className="mt-3 w-full max-w-md text-center text-sm">
          <thead><tr className="text-gray-500"><th className="text-left">단계</th><th>{n.pro}</th><th>{n.con}</th></tr></thead>
          <tbody>
            {FLOOR_PHASES.filter((p) => data.totals.byStage[p]).map((p) => (
              <tr key={p} className="border-t"><td className="py-1 text-left">{PHASE_LABEL[p]}</td>
                <td>{data.totals.byStage[p]?.pro ?? 0}</td><td>{data.totals.byStage[p]?.con ?? 0}</td></tr>
            ))}
          </tbody>
        </table>
        {data.totals.pendingCount + data.totals.failedCount > 0 && (
          <p className="mt-2 text-sm text-amber-800">채점 대기 {data.totals.pendingCount + data.totals.failedCount}건 (0점으로 계산)</p>
        )}
        {data.penalties.map((p, i) => (
          <p key={i} className="text-sm text-red-700">{n[p.side]} {p.points}점 · {PHASE_LABEL[p.phase]} · {p.reason}</p>
        ))}
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="mb-2 font-bold">종합 피드백</h2>
        {status === null && <p className="text-sm text-gray-500">결과를 아직 만들지 않았습니다.</p>}
        {status === "pending" && <p className="text-sm text-gray-500">AI 가 피드백을 쓰는 중입니다...</p>}
        {status === "skipped" && <p className="text-sm text-gray-500">발언이 없어 피드백을 만들지 않았습니다.</p>}
        {(status === "failed" || (status === null && data.debate.status === "closed")) && (
          <div className="flex items-center gap-2 text-sm">
            {status === "failed" && <span className="text-red-700">피드백을 만들지 못했습니다.</span>}
            <button onClick={() => call(`${base}/report/retry`)} className="rounded-lg border px-3 py-1">다시 만들기</button>
          </div>
        )}
        {data.report?.feedback && (
          <div className="flex flex-col gap-2 text-sm">
            {(["pro", "con"] as Side[]).map((s) => (
              <p key={s}><strong>{n[s]} 가장 좋았던 논증:</strong> {data.report!.feedback!.best[s].point} — {data.report!.feedback!.best[s].why}</p>
            ))}
            <p><strong>놓친 반박:</strong> {data.report.feedback.missed.join(" / ")}</p>
            <p><strong>다음 토론 제안:</strong> {data.report.feedback.suggestions.join(" / ")}</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="mb-2 font-bold">학생별 참여 (선생님만 봅니다)</h2>
        <ul className="grid gap-1 text-sm md:grid-cols-2">
          {data.members.map((m) => (
            <li key={m.id}><strong>{m.name}</strong> ({n[m.side]}) · 발언 {m.speechCount}번{m.note ? ` · ${m.note}` : ""}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="mb-2 font-bold">발언별 점수</h2>
        <ul className="flex flex-col gap-2">
          {data.floor.filter((m) => m.kind === "speech").map((m) => (
            <li key={m.id} className={`rounded-xl border p-3 text-sm ${m.hidden ? "bg-red-50" : ""}`}>
              <p className="text-xs text-gray-500">
                #{m.seq} · {PHASE_LABEL[m.phase]} · {m.side ? n[m.side] : ""} {m.author}{m.hidden ? " · 숨김 (점수 제외)" : ""}
              </p>
              <p>{m.content}</p>
              {m.score && editing?.scoreId === m.score.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {KEYS.map((k) => (
                    <label key={k} className="text-xs">{JUDGE_LABEL[k]}{" "}
                      <input type="number" min={RANGE[k][0]} max={RANGE[k][1]} value={editing.parts[k]}
                        onChange={(e) => setEditing({ ...editing, parts: { ...editing.parts, [k]: Number(e.target.value) } })}
                        className="w-14 rounded border px-1" />
                    </label>
                  ))}
                  <button onClick={async () => { if (await call(`${base}/scores/${editing.scoreId}`, editing.parts, "PATCH")) setEditing(null); }}
                    className="rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white">저장</button>
                  <button onClick={() => setEditing(null)} className="rounded border px-2 py-1 text-xs">취소</button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-gray-700">
                  {!m.score ? "채점 기록 없음" : m.score.status === "done"
                    ? `${m.score.total}점 · ${KEYS.map((k) => `${JUDGE_LABEL[k]} ${m.score![k === "phaseFit" ? "phaseFit" : k]}`).join(" · ")}${m.score.reason ? ` — ${m.score.reason}` : ""}`
                    : m.score.status === "failed" ? "채점 대기" : "채점 중"}
                  {m.score?.edited ? ` · 선생님 수정 ${edited.get(m.score.id) ?? 1}회` : ""}
                  {m.score && (
                    <button
                      onClick={() => setEditing({
                        scoreId: m.score!.id,
                        parts: {
                          logic: m.score!.logic ?? 0, evidence: m.score!.evidence ?? 0, response: m.score!.response ?? 0,
                          phaseFit: m.score!.phaseFit ?? 0, attitude: m.score!.attitude ?? 0,
                        },
                      })}
                      className="ml-2 rounded border px-1">점수 고치기</button>
                  )}
                  {(!m.score || (m.score.status === "failed" && !m.score.edited)) && (
                    <button onClick={() => call(`${base}/scores/${m.score?.id ?? m.id}/retry`)} className="ml-1 rounded border px-1">다시 채점</button>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Link href={`/teacher/classes/${data.debate.class_id}`} className="text-sm text-gray-500 underline">← 토론으로</Link>
    </div>
  );
}
