"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { mmss, remainingMs, useNow, useTeamPoll, type PollMessage, type PollScore } from "@/lib/team/poll-client";
import { JUDGE_LABEL } from "@/lib/prompts/team-judge-guide";
import { FLOOR_PHASES, NOTICE_MAX_LEN, PHASE_LABEL, nextPhase, type Side } from "@/lib/team/rules";

const SIDE_TONE: Record<Side, string> = {
  pro: "border-blue-300 bg-blue-50",
  con: "border-orange-300 bg-orange-50",
};

const ALERT_LABEL = {
  inappropriate: "🚨 부적절한 표현",
  duplicate_login: "📱 중복 접속",
  consecutive_pass: "⏭️ 연속 패스",
} as const;

async function send(url: string, body?: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, error: json.error };
}

/** 진행 관제실 (ver2 V-R10~V-R18, V-R48). 1.5초 폴링. */
export default function ControlRoomPage() {
  const { debateId } = useParams<{ debateId: string }>();
  const { snap, messages, error, refresh } = useTeamPoll(`/api/team-debates/${debateId}/poll`);
  const now = useNow();
  const [notice, setNotice] = useState("");
  const [warn, setWarn] = useState<Record<Side, string>>({ pro: "", con: "" });
  const [confirming, setConfirming] = useState<"next" | "end" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const scoreBySeq = useMemo(() => new Map((snap?.scores ?? []).map((s) => [s.seq, s])), [snap?.scores]);
  const hidden = useMemo(() => new Set(snap?.hiddenSeqs ?? []), [snap?.hiddenSeqs]);

  if (error?.status === 404) return <p className="text-red-700">찾을 수 없습니다.</p>;
  if (!snap) return <p className="text-gray-500">불러오는 중...</p>;

  const d = snap.debate;
  const names: Record<Side, string> = { pro: d.proName, con: d.conName };
  const phaseLeft = remainingMs(d.phaseRemainingMs, snap, now);
  const turnLeft = remainingMs(snap.turn?.remainingMs, snap, now);
  const base = `/api/team-debates/${debateId}`;

  async function act(action: string) {
    setMsg(null);
    setConfirming(null);
    const r = await send(base, { action }, "PATCH");
    if (!r.ok) setMsg(r.error ?? "처리하지 못했어요.");
    void refresh();
  }

  async function announce() {
    const r = await send(`${base}/announce`, { content: notice });
    if (r.ok) setNotice(""); else setMsg(r.error ?? "공지하지 못했어요.");
    void refresh();
  }

  async function sendWarn(side: Side) {
    const r = await send(`${base}/warn`, { side, content: warn[side] });
    if (r.ok) setWarn((w) => ({ ...w, [side]: "" })); else setMsg(r.error ?? "보내지 못했어요.");
    void refresh();
  }

  async function toggleHidden(m: PollMessage) {
    const r = await send(`${base}/messages/${m.id}`, { hidden: !hidden.has(m.seq) }, "PATCH");
    if (!r.ok) setMsg(r.error ?? "처리하지 못했어요.");
    void refresh();
  }

  async function rescore(m: PollMessage, sc: PollScore | undefined) {
    const r = await send(`${base}/scores/${sc?.scoreId ?? m.id}/retry`);
    if (!r.ok) setMsg(r.error ?? "다시 채점하지 못했어요.");
    void refresh();
  }

  const live = d.status === "open";
  const next = nextPhase(d.phase);
  const timeLeft = (phaseLeft ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* 상단 고정 알림 (V-R48) */}
      {(snap.alerts ?? []).length > 0 && (
        <section className="sticky top-0 z-10 flex flex-col gap-2 rounded-2xl border-2 border-red-300 bg-red-50 p-3">
          {(snap.alerts ?? []).map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <strong>{ALERT_LABEL[a.kind]}</strong> {a.name ? `· ${a.name}` : ""}
                {a.side ? ` · ${names[a.side]}` : ""}
                {a.channel ? ` · ${a.channel === "floor" ? "토론방" : "팀 채팅"}` : ""}
                {a.excerpt ? ` · “${a.excerpt}”` : ""} {a.kind !== "inappropriate" && a.detail ? `· ${a.detail}` : ""}
              </span>
              <button onClick={async () => { await send(`${base}/alerts/${a.id}/acknowledge`); void refresh(); }}
                className="rounded-lg border bg-white px-2 py-1 text-xs">확인함</button>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-2xl border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500">팀 토론 관제실 · 초등 {d.gradeLevel}학년</p>
            <h1 className="text-xl font-bold">{d.topic}</h1>
            <p className="mt-1">
              <span className="rounded-full bg-gray-800 px-3 py-1 text-sm font-bold text-white">{PHASE_LABEL[d.phase]}</span>
              {d.paused && <span className="ml-2 rounded-full bg-amber-400 px-3 py-1 text-sm font-bold">일시정지</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">단계 남은 시간</p>
            <p className="font-mono text-3xl font-bold">{mmss(phaseLeft)}</p>
          </div>
        </div>

        {msg && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p>}

        <div className="mt-3 flex flex-wrap gap-2">
          {live && d.phase === "waiting" && (
            <>
              <button onClick={() => act("start")} className="rounded-lg bg-green-600 px-4 py-2 font-bold text-white">토론 시작</button>
              <Link href={`/teacher/team-debates/${debateId}/setup`} className="rounded-lg border px-4 py-2">팀 배정 고치기</Link>
            </>
          )}
          {live && next && d.phase !== "waiting" && (
            confirming === "next" ? (
              <span className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-1 text-sm">
                시간이 남았어요. {PHASE_LABEL[next]} 단계로 건너뛸까요?
                <button onClick={() => act("next")} className="rounded bg-blue-600 px-2 py-1 font-bold text-white">건너뛰기</button>
                <button onClick={() => setConfirming(null)} className="rounded border px-2 py-1">취소</button>
              </span>
            ) : (
              <button
                onClick={() => (timeLeft ? setConfirming("next") : act("next"))}
                className="rounded-lg bg-blue-600 px-4 py-2 font-bold text-white"
              >
                다음 단계로 ({PHASE_LABEL[next]})
              </button>
            )
          )}
          {live && d.phase !== "waiting" && (
            d.paused
              ? <button onClick={() => act("resume")} className="rounded-lg bg-amber-500 px-4 py-2 font-bold text-white">다시 시작</button>
              : <button onClick={() => act("pause")} className="rounded-lg border px-4 py-2">일시정지</button>
          )}
          {live && d.phase !== "waiting" && (
            <button onClick={() => act("extend")} className="rounded-lg border px-4 py-2">1분 연장</button>
          )}
          {live && (
            confirming === "end" ? (
              <span className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-1 text-sm">
                토론을 끝낼까요? 다시 열 수 없어요.
                <button onClick={() => act("end")} className="rounded bg-red-600 px-2 py-1 font-bold text-white">끝내기</button>
                <button onClick={() => setConfirming(null)} className="rounded border px-2 py-1">취소</button>
              </span>
            ) : (
              <button onClick={() => setConfirming("end")} className="rounded-lg bg-gray-800 px-4 py-2 font-bold text-white">토론 종료</button>
            )
          )}
          {d.status === "closed" && (
            <Link href={`/teacher/team-debates/${debateId}/report`} className="rounded-lg bg-blue-600 px-4 py-2 font-bold text-white">
              결과 보고서
            </Link>
          )}
        </div>

        {snap.turn && snap.floorState === "open" && (
          <p className="mt-3 text-sm">
            지금 차례: <strong>{names[snap.turn.side]}</strong> · 남은 {mmss(turnLeft)}
            {snap.turn.lockName ? ` · ✍️ ${snap.turn.lockName} 쓰는 중` : ""}
          </p>
        )}
        {snap.floorState === "time_up" && <p className="mt-3 text-sm text-amber-800">단계 시간이 끝나 토론방이 잠겼습니다.</p>}
        {snap.floorState === "final_done" && <p className="mt-3 text-sm text-gray-700">두 팀 모두 최종 발언을 마쳤습니다.</p>}
      </section>

      {/* 점수판 + 접속 상태 */}
      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border bg-white p-4">
          <h2 className="mb-2 font-bold">실시간 점수판</h2>
          {snap.totals && (
            <>
              <p className="text-2xl font-bold">
                {names.pro} {snap.totals.pro} : {snap.totals.con} {names.con}
              </p>
              <table className="mt-2 w-full text-center text-sm">
                <tbody>
                  {FLOOR_PHASES.filter((p) => snap.totals!.byStage[p]).map((p) => (
                    <tr key={p} className="border-t">
                      <td className="py-1 text-left">{PHASE_LABEL[p]}</td>
                      <td>{snap.totals!.byStage[p]?.pro ?? 0}</td>
                      <td>{snap.totals!.byStage[p]?.con ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-gray-500">
                채점 중 {snap.totals.pendingCount} · 채점 대기 {snap.totals.failedCount} · 학생 공개:{" "}
                {d.scoreVisibility === "live" ? "실시간" : "결과 공개 뒤"}
              </p>
            </>
          )}
          {(snap.penalties ?? []).map((p, i) => (
            <p key={i} className="text-xs text-red-700">{names[p.side]} {p.points}점 · {PHASE_LABEL[p.phase]} · {p.reason}</p>
          ))}
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <h2 className="mb-2 font-bold">학생 접속·발언</h2>
          {(["pro", "con"] as Side[]).map((side) => (
            <div key={side} className="mb-2">
              <p className="text-sm font-bold">{names[side]}</p>
              <ul className="flex flex-wrap gap-1 text-sm">
                {snap.members.filter((m) => m.side === side).map((m) => (
                  <li key={m.id} className="rounded-full bg-gray-100 px-2 py-0.5">
                    <span className={m.online ? "text-green-600" : "text-gray-400"}>●</span> {m.name} {m.speechCount}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {live && (
        <section className="flex gap-2 rounded-2xl border bg-white p-3">
          <input value={notice} onChange={(e) => setNotice(e.target.value.slice(0, NOTICE_MAX_LEN))}
            placeholder="전체 공지 (토론방 맨 위에 고정돼요)"
            className="flex-1 rounded-lg border-2 border-gray-200 px-3 py-2" />
          <button onClick={announce} disabled={!notice.trim()} className="rounded-lg bg-amber-500 px-4 font-bold text-white disabled:bg-gray-300">공지</button>
        </section>
      )}
      {snap.announcement && (
        <p className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-sm">📌 고정 공지: {snap.announcement.content}</p>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {/* 전체 토론방 */}
        <section className="rounded-2xl border bg-white p-3 lg:col-span-1">
          <h2 className="mb-2 font-bold">🏛️ 전체 토론방</h2>
          <ul className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
            {messages.filter((m) => m.channel === "floor").map((m) => {
              if (m.kind !== "speech" || !m.side) {
                return <li key={m.seq} className="text-center text-xs text-gray-500">#{m.seq} {m.kind === "announcement" ? "📌 " : ""}{m.content}</li>;
              }
              const sc = scoreBySeq.get(m.seq);
              const isHidden = hidden.has(m.seq);
              return (
                <li key={m.seq} className={`rounded-xl border-2 px-3 py-2 text-sm ${SIDE_TONE[m.side]} ${isHidden ? "opacity-60" : ""}`}>
                  <p className="flex items-center justify-between text-xs text-gray-600">
                    <span>#{m.seq} · {PHASE_LABEL[m.phase]} · {names[m.side]} {m.author}</span>
                    <button onClick={() => toggleHidden(m)} className="rounded border bg-white px-1">
                      {isHidden ? "되돌리기" : "숨기기"}
                    </button>
                  </p>
                  <p className={isHidden ? "line-through" : ""}>{m.content}</p>
                  {isHidden && <p className="text-xs font-bold text-red-700">숨김 · 점수 제외</p>}
                  <ScoreLine sc={sc} onRetry={() => rescore(m, sc)} />
                </li>
              );
            })}
          </ul>
        </section>

        {/* 두 팀 채팅 나란히 (V-R48) */}
        {(["pro", "con"] as Side[]).map((side) => (
          <section key={side} className={`rounded-2xl border-2 p-3 ${SIDE_TONE[side]}`}>
            <h2 className="mb-2 font-bold">💬 {names[side]} 채팅</h2>
            <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto text-sm">
              {messages.filter((m) => m.channel === side).map((m) => (
                <li key={m.seq} className={`rounded-lg bg-white px-2 py-1 ${m.kind === "teacher_warning" ? "border border-red-300" : ""}`}>
                  <span className="text-xs text-gray-500">
                    {m.kind === "teacher_warning" ? "👩‍🏫 선생님" : m.author}{m.kind === "draft" ? " (못 보낸 발언)" : ""}:
                  </span>{" "}
                  {m.content}
                </li>
              ))}
            </ul>
            {live && (
              <div className="mt-2 flex gap-1">
                <input value={warn[side]} onChange={(e) => setWarn((w) => ({ ...w, [side]: e.target.value.slice(0, NOTICE_MAX_LEN) }))}
                  placeholder="이 팀에게 경고 보내기" className="flex-1 rounded-lg border px-2 py-1 text-sm" />
                <button onClick={() => sendWarn(side)} disabled={!warn[side].trim()}
                  className="rounded-lg bg-red-600 px-2 text-sm font-bold text-white disabled:bg-gray-300">보내기</button>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function ScoreLine({ sc, onRetry }: { sc: PollScore | undefined; onRetry: () => void }) {
  if (!sc || sc.status === "pending") {
    return (
      <p className="mt-1 text-xs text-gray-500">
        채점 중 {!sc && <button onClick={onRetry} className="ml-1 underline">채점 시작</button>}
      </p>
    );
  }
  if (sc.status === "failed") {
    return (
      <p className="mt-1 text-xs text-red-700">
        채점 대기 <button onClick={onRetry} className="ml-1 rounded border bg-white px-1">다시 채점</button>
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-gray-700">
      <strong>{sc.total}점</strong> · {JUDGE_LABEL.logic} {sc.logic} · {JUDGE_LABEL.evidence} {sc.evidence} ·{" "}
      {JUDGE_LABEL.response} {sc.response} · {JUDGE_LABEL.phaseFit} {sc.phaseFit} · {JUDGE_LABEL.attitude} {sc.attitude}
      {sc.edited ? " · 수정됨" : ""}
      {sc.respondedToSeq ? ` · #${sc.respondedToSeq}에 대응` : ""}
      {sc.reason ? <span className="block text-gray-600">{sc.reason}</span> : null}
    </p>
  );
}
