"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** scoring.ts 의 AREAS 와 같은 순서·배점을 쓴다. */
const AREAS = [
  { key: "claim", label: "주장 표현", max: 15 },
  { key: "evidence", label: "근거의 적절성과 구체성", max: 25 },
  { key: "counter", label: "반론 이해와 대응", max: 25 },
  { key: "development", label: "생각의 발전과 조정", max: 25 },
  { key: "participation", label: "토론 참여와 답변 충실성", max: 10 },
] as const;

interface ResultData {
  topic: string;
  stance: "pro" | "con";
  messageCount: number;
  score: {
    status: "pending" | "done" | "failed" | "skipped";
    total: number | null;
    baseTotal: number | null;
    offTopicPenalty: number | null;
    scores: Record<string, number | null> | null;
    reasons: Record<string, string> | null;
    strengths: string[] | null;
    nextStep: string | null;
  } | null;
}

/** 영역 점수를 막대로 보여준다. 숫자만 보는 것보다 어디가 부족한지 한눈에 들어온다. */
function Bar({ value, max }: { value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-200">
      <div
        className={`h-full rounded-full ${pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-blue-500" : "bg-amber-500"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ResultInner() {
  const router = useRouter();
  const sessionId = useSearchParams().get("sessionId");
  const [data, setData] = useState<ResultData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    async function poll() {
      const res = await fetch(`/api/debate/result?sessionId=${sessionId}`);
      if (!alive) return;
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? "결과를 불러오지 못했어요.");
        return;
      }
      const body = (await res.json()) as ResultData;
      setData(body);
      if (!body.score || body.score.status === "pending") setTimeout(poll, 3000);
    }
    void poll();
    return () => { alive = false; };
  }, [sessionId]);

  if (error) return <main className="student-scope p-8 text-red-700">{error}</main>;
  if (!data) return <main className="student-scope p-8 text-gray-500">불러오는 중...</main>;

  const score = data.score;
  const done = score?.status === "done";
  const penalty = score?.offTopicPenalty ?? 0;

  return (
    <main className="student-scope mx-auto max-w-lg px-5 py-10">
      <div className="mb-3 text-center">
        <div className="mascot-bubble text-6xl" aria-hidden="true">🏆</div>
        <span className="kid-badge mt-3">참 잘했어요!</span>
      </div>
      <p className="text-sm font-bold text-blue-700">오늘의 토론</p>
      <h1 className="mb-1 text-xl font-bold">{data.topic}</h1>
      <p className="mb-6 text-gray-600">
        내 입장: {data.stance === "pro" ? "찬성" : "반대"} · 말한 횟수 {data.messageCount}회
      </p>

      {!score || score.status === "pending" ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-bold">채점하고 있어요</p>
          <p className="mt-1 text-gray-600">조금만 기다려줘.</p>
        </div>
      ) : score.status === "skipped" ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-bold">오늘 토론하느라 수고했어요</p>
          <p className="mt-1 text-gray-600">이야기가 조금 짧아서 점수는 매기지 않았어요.</p>
        </div>
      ) : score.status === "failed" ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-bold">오늘 토론하느라 수고했어요</p>
        </div>
      ) : null}

      {done && (
        <>
          <div className="rounded-2xl bg-blue-600 p-6 text-center text-white">
            <p className="text-sm font-bold opacity-90">⭐ 내 토론 점수</p>
            <p className="text-4xl font-bold">
              {score.total}
              <span className="text-xl font-normal"> / 100점</span>
            </p>
            {penalty < 0 && (
              <p className="mt-2 text-sm opacity-90">
                기본 {score.baseTotal}점 · 주제에서 벗어나 {penalty}점
              </p>
            )}
          </div>

          <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
            {AREAS.map((a) => {
              const v = score.scores?.[a.key] ?? 0;
              return (
                <div key={a.key} className="mb-4 last:mb-0">
                  <div className="flex items-baseline justify-between">
                    <span className="font-bold">{a.label}</span>
                    <span className="text-sm">
                      <span className="text-lg font-bold">{v}</span>
                      <span className="text-gray-500"> / {a.max}</span>
                    </span>
                  </div>
                  <Bar value={v} max={a.max} />
                  {score.reasons?.[a.key] && (
                    <p className="mt-1 text-sm text-gray-600">{score.reasons[a.key]}</p>
                  )}
                </div>
              );
            })}
          </div>

          {penalty < 0 && score.reasons?.offTopic && (
            <div className="mt-3 rounded-2xl bg-orange-50 p-5">
              <p className="mb-1 font-bold text-orange-900">주제 이탈 {penalty}점</p>
              <p className="text-orange-900">{score.reasons.offTopic}</p>
            </div>
          )}

          {score.strengths && score.strengths.length > 0 && (
            <div className="mt-4 rounded-2xl bg-green-50 p-5">
              <p className="mb-2 font-bold text-green-900">🌱 잘한 점</p>
              <ul className="list-inside list-disc text-green-900">
                {score.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {score.nextStep && (
            <div className="mt-3 rounded-2xl bg-amber-50 p-5">
              <p className="mb-1 font-bold text-amber-900">💡 다음에는 이렇게 해봐요</p>
              <p className="text-amber-900">{score.nextStep}</p>
            </div>
          )}
        </>
      )}

      <button
        onClick={() => router.push("/debate")}
        className="mt-6 w-full rounded-2xl bg-gray-200 px-6 py-4 font-bold"
      >
        토론 내용 다시 보기
      </button>
    </main>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<main className="student-scope p-8 text-gray-500">불러오는 중...</main>}>
      <ResultInner />
    </Suspense>
  );
}
