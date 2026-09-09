"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** scoring.ts 의 AREAS 와 같은 순서·배점 */
const AREAS = [
  { key: "claim", label: "주장 표현", max: 15 },
  { key: "evidence", label: "근거의 적절성과 구체성", max: 25 },
  { key: "counter", label: "반론 이해와 대응", max: 25 },
  { key: "development", label: "생각의 발전과 조정", max: 25 },
  { key: "participation", label: "토론 참여와 답변 충실성", max: 10 },
] as const;

interface StudentTile {
  student_id: string; display_name: string; participation_id: string | null;
  stance: "pro" | "con" | null; message_count: number; last_activity_at: string | null;
  off_topic_count: number; inappropriate_count: number; unacked_count: number;
  score_status: "pending" | "done" | "failed" | "skipped" | null; score_total: number | null;
}
interface Alert {
  flag_id: string; display_name: string; reason: string | null;
  created_at: string; excerpt: string; participation_id: string;
}
interface Snapshot {
  session: {
    id: string; class_id: string; class_name: string; topic: string; description: string | null;
    grade_level: number; status: "draft" | "open" | "closed"; message_limit: number;
  };
  students: StudentTile[];
  alerts: Alert[];
  summary: {
    totalStudents: number; joinedStudents: number; proCount: number; conCount: number;
    totalMessages: number; offTopicTotal: number; inappropriateTotal: number;
    scoredCount: number; averageTotal: number | null;
  };
}
interface Detail {
  student: { name: string };
  stance: "pro" | "con";
  messageCount: number;
  messages: {
    id: string; role: "student" | "bot"; content: string;
    verdict: string | null; reason: string | null; triageFailed: boolean;
  }[];
  score: {
    status: string; total: number | null; baseTotal: number | null;
    offTopicPenalty: number | null; scores: Record<string, number | null>;
    reasons: Record<string, string> | null; strengths: string[] | null;
    nextStep: string | null;
    analysis: { evidence: string; counter: string; shortAnswers: string; focus: string } | null;
    changeSummary: string | null; changeReason: string | null;
    error: string | null;
  } | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "-";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "방금";
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return `${Math.floor(sec / 3600)}시간 전`;
}

export default function DashboardPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPid, setOpenPid] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const panelBottomRef = useRef<HTMLDivElement>(null);

  // 갱신은 열려 있는 상세 패널을 닫지 않는다 (AC14). 패널이 열려 있으면 함께 새로 고친다.
  const load = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/dashboard`, { cache: "no-store" });
    if (res.status === 404) { setError("찾을 수 없습니다."); return; }
    if (!res.ok) return;
    setSnap(await res.json());
    if (openPid) {
      const d = await fetch(`/api/sessions/${sessionId}/participations/${openPid}`);
      if (d.ok) setDetail(await d.json());
    }
  }, [sessionId, openPid]);

  // 최초 1회 + 3초 자동 갱신 (R29)
  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) void load(); };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 3000);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); };
  }, [load]);

  async function openDetail(pid: string) {
    if (pid === openPid) { closeDetail(); return; } // 같은 타일을 다시 누르면 닫힌다
    setOpenPid(pid);
    setDetail(null);
    const res = await fetch(`/api/sessions/${sessionId}/participations/${pid}`);
    if (res.ok) setDetail(await res.json());
  }

  const closeDetail = useCallback(() => {
    setOpenPid(null);
    setDetail(null);
  }, []);

  // ESC 로 닫는다
  useEffect(() => {
    if (!openPid) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDetail(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPid, closeDetail]);

  // 새 발언이 들어오면 패널 아래로 따라간다. 교사가 위를 읽는 중이면 건드리지 않는다.
  useEffect(() => {
    const el = panelBottomRef.current;
    if (!el) return;
    const box = el.parentElement?.parentElement;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (nearBottom) el.scrollIntoView({ block: "end" });
  }, [detail?.messages.length]);

  async function acknowledge(flagId: string) {
    await fetch(`/api/flags/${flagId}/acknowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    await load();
  }

  async function retryScore(pid: string) {
    await fetch(`/api/participations/${pid}/score/retry`, { method: "POST" });
    await load();
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!snap) return <p className="text-gray-500">불러오는 중...</p>;

  const s = snap.summary;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">
            {snap.session.class_name} · 초등 {snap.session.grade_level}학년 ·{" "}
            {snap.session.status === "open" ? "진행 중" : snap.session.status === "closed" ? "끝남" : "준비 중"}
          </p>
          <h1 className="text-xl font-bold">{snap.session.topic}</h1>
        </div>
        <a href={`/api/sessions/${sessionId}/export`}
          className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-bold text-white">PDF 내려받기</a>
      </div>

      {/* 부적절 발언은 상단에 고정한다 (R30) */}
      {snap.alerts.length > 0 && (
        <section className="sticky top-0 z-10 rounded-2xl border-2 border-red-300 bg-red-50 p-4 shadow-md">
          <h2 className="mb-2 font-bold text-red-800">확인이 필요한 발언 {snap.alerts.length}건</h2>
          <ul className="flex flex-col gap-2">
            {snap.alerts.map((a) => (
              <li key={a.flag_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3">
                <div>
                  <p className="font-bold">{a.display_name}</p>
                  <p className="text-sm text-gray-700">&ldquo;{a.excerpt}&rdquo;</p>
                  {a.reason && <p className="text-xs text-gray-500">{a.reason}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openDetail(a.participation_id)}
                    className="rounded-lg border px-3 py-1.5 text-sm">대화 보기</button>
                  <button onClick={() => acknowledge(a.flag_id)}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white">확인함</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "참여", value: `${s.joinedStudents} / ${s.totalStudents}명` },
          { label: "찬성 · 반대", value: `${s.proCount} · ${s.conCount}` },
          { label: "발언 수", value: `${s.totalMessages}회` },
          { label: "채점 · 반 평균", value: `${s.scoredCount}명 · ${s.averageTotal ?? "-"}${s.averageTotal != null ? "점" : ""}` },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border bg-white p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className="text-lg font-bold">{c.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {snap.students.map((st) => {
          const bad = st.inappropriate_count > 0;
          const off = st.off_topic_count > 0;
          return (
            <button
              key={st.student_id}
              onClick={() => st.participation_id && openDetail(st.participation_id)}
              disabled={!st.participation_id}
              className={`group rounded-2xl border-2 bg-white p-4 text-left transition ${
                st.participation_id === openPid
                  ? "border-blue-600 ring-2 ring-blue-200"
                  : bad
                    ? "border-red-400"
                    : off
                      ? "border-amber-300"
                      : "border-gray-200"
              } ${st.participation_id ? "cursor-pointer hover:border-blue-400 hover:shadow-sm" : "opacity-60"}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold">{st.display_name}</span>
                <span className="flex gap-1">
                  {bad && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">부적절 {st.inappropriate_count}</span>}
                  {off && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-amber-900">이탈 {st.off_topic_count}</span>}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                {st.participation_id
                  ? `${st.stance === "pro" ? "찬성" : "반대"} · ${st.message_count} / ${snap.session.message_limit}회 · ${timeAgo(st.last_activity_at)}`
                  : "아직 들어오지 않음"}
              </p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-sm">
                  {st.score_status === "done" ? (
                    <span className="font-bold text-blue-700">{st.score_total} / 100점</span>
                  ) : st.score_status === "pending" ? (
                    <span className="text-gray-500">채점 중</span>
                  ) : st.score_status === "skipped" ? (
                    <span className="text-gray-500">대화 부족</span>
                  ) : st.score_status === "failed" ? (
                    <span className="text-red-600">채점 실패</span>
                  ) : null}
                </p>
                {st.participation_id && (
                  <span
                    className={`text-xs font-bold ${
                      st.participation_id === openPid
                        ? "text-blue-700"
                        : "text-gray-400 group-hover:text-blue-600"
                    }`}
                  >
                    {st.participation_id === openPid ? "보는 중" : "대화 보기 →"}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </section>

      {/*
        상세 대화는 화면에 고정되는 패널로 띄운다. 그리드 아래에 두면 25명 반에서
        위쪽 타일을 눌렀을 때 화면 밖으로 밀려 열린 줄도 모른다.
      */}
      {openPid && (
        <>
          <div
            onClick={closeDetail}
            className="fixed inset-0 z-20 bg-black/20 lg:bg-transparent"
            aria-hidden
          />
          <section
            role="dialog"
            aria-label={`${detail?.student.name ?? "학생"}의 토론`}
            className="fixed inset-x-0 bottom-0 z-30 flex max-h-[85dvh] flex-col rounded-t-2xl border bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-full sm:max-w-md sm:rounded-l-2xl sm:rounded-tr-none"
          >
            <div className="flex items-start justify-between gap-3 border-b px-5 py-3">
              <div>
                <h2 className="font-bold">{detail?.student.name ?? "학생"} 의 토론</h2>
                {detail && (
                  <p className="text-xs text-gray-500">
                    {detail.stance === "pro" ? "찬성" : "반대"} · 발언 {detail.messageCount}회
                  </p>
                )}
              </div>
              <button
                onClick={closeDetail}
                className="shrink-0 rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
              >
                닫기
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
          {!detail ? (
            <p className="text-gray-500">불러오는 중...</p>
          ) : (
            <>
              {detail.score && (
                <div className="mb-4 rounded-xl bg-gray-50 p-4">
                  {detail.score.status === "done" ? (
                    <>
                      <p className="mb-1 font-bold">최종 점수 {detail.score.total} / 100점</p>
                      <p className="mb-2 text-xs text-gray-600">
                        기본 {detail.score.baseTotal ?? "-"}점 · 주제 이탈 감점{" "}
                        {detail.score.offTopicPenalty ?? 0}점
                      </p>
                      {AREAS.map((a) => (
                        <p key={a.key} className="text-sm">
                          <span className="inline-block w-44 text-gray-600">{a.label}</span>
                          <span className="font-bold">
                            {detail.score?.scores?.[a.key] ?? "-"} / {a.max}
                          </span>
                          <span className="ml-2 text-gray-600">{detail.score?.reasons?.[a.key] ?? ""}</span>
                        </p>
                      ))}
                      {(detail.score.offTopicPenalty ?? 0) < 0 && detail.score.reasons?.offTopic && (
                        <p className="text-sm">
                          <span className="inline-block w-44 text-gray-600">주제 이탈</span>
                          <span className="font-bold">{detail.score.offTopicPenalty}</span>
                          <span className="ml-2 text-gray-600">{detail.score.reasons.offTopic}</span>
                        </p>
                      )}
                      {detail.score.strengths && (
                        <p className="mt-2 text-sm">잘한 점: {detail.score.strengths.join(" / ")}</p>
                      )}
                      {detail.score.nextStep && (
                        <p className="text-sm">더 발전시키면 좋은 점: {detail.score.nextStep}</p>
                      )}
                      {detail.score.analysis && (
                        <p className="mt-2 text-xs text-gray-600">
                          근거 제시 {detail.score.analysis.evidence} · 반론 대응{" "}
                          {detail.score.analysis.counter} · 단답식 {detail.score.analysis.shortAnswers} ·
                          주제 집중 {detail.score.analysis.focus}
                        </p>
                      )}
                      {detail.score.changeSummary && (
                        <p className="text-xs text-gray-600">
                          생각의 변화: {detail.score.changeSummary}
                          {detail.score.changeReason ? ` — ${detail.score.changeReason}` : ""}
                        </p>
                      )}
                    </>
                  ) : detail.score.status === "failed" ? (
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-red-700">채점에 실패했습니다.</p>
                      <button onClick={() => retryScore(openPid)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white">다시 채점</button>
                    </div>
                  ) : detail.score.status === "skipped" ? (
                    <p className="text-sm text-gray-600">대화가 짧아 채점하지 않았습니다.</p>
                  ) : (
                    <p className="text-sm text-gray-600">채점 중입니다.</p>
                  )}
                </div>
              )}

              {detail.messages.length === 0 ? (
                <p className="text-sm text-gray-500">아직 대화가 없습니다.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {detail.messages.map((m) => (
                    <div key={m.id}
                      className={`rounded-xl px-4 py-2 ${
                        m.verdict === "inappropriate" ? "bg-red-50"
                          : m.verdict === "off_topic" ? "bg-amber-50"
                          : m.role === "student" ? "bg-blue-50" : "bg-gray-50"
                      }`}>
                      <p className="text-xs text-gray-500">
                        {m.role === "student" ? detail.student.name : "토론 친구"}
                        {m.verdict === "off_topic" && " · 주제에서 벗어남"}
                        {m.verdict === "inappropriate" && " · 부적절한 표현"}
                        {m.triageFailed && " · 판정 실패"}
                      </p>
                      <p>{m.content}</p>
                    </div>
                  ))}
                  {/* 3초 갱신으로 새 발언이 들어오면 여기로 스크롤한다 */}
                  <div ref={panelBottomRef} />
                </div>
              )}
            </>
          )}
            </div>
          </section>
        </>
      )}

      <Link href={`/teacher/classes/${snap.session.class_id}`} className="text-sm text-gray-500 underline">
        ← {snap.session.class_name}
      </Link>
    </div>
  );
}
