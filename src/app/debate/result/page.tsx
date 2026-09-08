"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const LABEL: Record<string, string> = {
  evidence: "근거 대기",
  listening: "상대 말에 답하기",
  development: "생각 이어가기",
  expression: "알기 쉽게 말하기",
};
const ORDER = ["evidence", "listening", "development", "expression"];

interface ResultData {
  topic: string;
  stance: "pro" | "con";
  messageCount: number;
  score: {
    status: "pending" | "done" | "failed" | "skipped";
    total: number | null;
    scores: Record<string, number | null> | null;
    reasons: Record<string, string> | null;
    strengths: string[] | null;
    nextStep: string | null;
  } | null;
}

function Stars({ n }: { n: number }) {
  return (
    <span className="text-lg tracking-tight" aria-label={`${n}점`}>
      {"★".repeat(n)}
      <span className="text-gray-300">{"★".repeat(5 - n)}</span>
    </span>
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
      // 채점이 끝날 때까지 기다린다.
      if (!body.score || body.score.status === "pending") setTimeout(poll, 3000);
    }
    void poll();
    return () => { alive = false; };
  }, [sessionId]);

  if (error) return <main className="student-scope p-8 text-red-700">{error}</main>;
  if (!data) return <main className="student-scope p-8 text-gray-500">불러오는 중...</main>;

  const score = data.score;
  const done = score?.status === "done";

  return (
    <main className="student-scope mx-auto max-w-lg px-5 py-10">
      <p className="text-sm text-gray-500">오늘의 토론</p>
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
            <p className="text-sm opacity-90">내 토론 점수</p>
            <p className="text-4xl font-bold">
              {score.total}
              <span className="text-xl font-normal"> / 20점</span>
            </p>
          </div>

          <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
            {ORDER.map((k) => (
              <div key={k} className="mb-3 last:mb-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold">{LABEL[k]}</span>
                  <Stars n={score.scores?.[k] ?? 0} />
                </div>
                {score.reasons?.[k] && (
                  <p className="mt-1 text-sm text-gray-600">{score.reasons[k]}</p>
                )}
              </div>
            ))}
          </div>

          {score.strengths && score.strengths.length > 0 && (
            <div className="mt-4 rounded-2xl bg-green-50 p-5">
              <p className="mb-2 font-bold text-green-900">잘한 점</p>
              <ul className="list-inside list-disc text-green-900">
                {score.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {score.nextStep && (
            <div className="mt-3 rounded-2xl bg-amber-50 p-5">
              <p className="mb-1 font-bold text-amber-900">다음에 해볼 것</p>
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
