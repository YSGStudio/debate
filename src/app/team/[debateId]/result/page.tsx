"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FLOOR_PHASES, PHASE_LABEL, type Side, type TeamPhase } from "@/lib/team/rules";

type Result =
  | { status: "preparing"; topic: string }
  | {
      topic: string;
      teams: Record<Side, { name: string; total: number }>;
      winner: Side | "draw" | null;
      stageScores: Partial<Record<TeamPhase, Record<Side, number>>>;
      feedback: { best: Record<Side, { point: string; why: string }>; missed: string[]; suggestions: string[] } | null;
      pendingCount: number;
    };

/**
 * 학생 결과 화면 (ver2 V-R43).
 * 우승팀, 두 팀 총점·단계별 점수, 전체 피드백만. 개인 점수·발언 수는 없다.
 */
export default function TeamResultPage() {
  const { debateId } = useParams<{ debateId: string }>();
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/team/result?debateId=${debateId}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError((body as { error?: string }).error ?? "결과를 불러오지 못했어요."); return; }
    setData(body as Result);
  }, [debateId]);

  // 공개 전이면 몇 초마다 다시 본다
  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) void load(); };
    const first = setTimeout(tick, 0);
    const timer = setInterval(() => {
      if (data && !("status" in data)) return;
      tick();
    }, 4000);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); };
  }, [load, data]);

  if (error) {
    return (
      <main className="student-scope mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
        <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>
        <Link href="/debate" className="rounded-2xl bg-gray-200 px-6 py-4 font-bold">돌아가기</Link>
      </main>
    );
  }
  if (!data) return <main className="student-scope p-8 text-gray-500">불러오는 중...</main>;

  if ("status" in data) {
    return (
      <main className="student-scope mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
        <div className="mascot-bubble text-5xl" aria-hidden="true">⏳</div>
        <p className="text-xl font-bold">선생님이 결과를 준비하고 있어요</p>
        <p className="text-gray-600">{data.topic}</p>
      </main>
    );
  }

  const { teams, winner } = data;
  const headline = winner === null ? "발언이 없어 결과가 없어요" : winner === "draw" ? "무승부예요!" : `${teams[winner].name} 승리!`;
  const stages = FLOOR_PHASES.filter((p) => data.stageScores[p]);

  return (
    <main className="student-scope mx-auto max-w-2xl px-5 py-10">
      <div className="mb-6 text-center">
        <div className="mascot-bubble text-5xl" aria-hidden="true">🏆</div>
        <span className="kid-badge mt-3">팀 토론 결과</span>
        <h1 className="mt-3 text-2xl font-bold">{headline}</h1>
        <p className="mt-1 text-gray-600">{data.topic}</p>
      </div>

      <section className="kid-card mb-4 p-5">
        <div className="flex justify-around text-center">
          {(["pro", "con"] as Side[]).map((s) => (
            <div key={s}>
              <p className="font-bold">{teams[s].name}</p>
              <p className="text-4xl font-bold">{teams[s].total}</p>
            </div>
          ))}
        </div>
        {stages.length > 0 && (
          <table className="mt-4 w-full text-center text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="py-1">단계</th>
                <th>{teams.pro.name}</th>
                <th>{teams.con.name}</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((p) => (
                <tr key={p} className="border-t">
                  <td className="py-1">{PHASE_LABEL[p]}</td>
                  <td>{data.stageScores[p]?.pro ?? 0}</td>
                  <td>{data.stageScores[p]?.con ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.pendingCount > 0 && (
          <p className="mt-2 text-xs text-gray-500">채점하지 못한 발언 {data.pendingCount}개는 0점으로 계산했어요.</p>
        )}
      </section>

      {data.feedback && (
        <section className="kid-card flex flex-col gap-3 p-5">
          {(["pro", "con"] as Side[]).map((s) => (
            <div key={s}>
              <p className="font-bold">👍 {teams[s].name}의 가장 좋았던 말</p>
              <p>{data.feedback!.best[s].point}</p>
              <p className="text-sm text-gray-600">{data.feedback!.best[s].why}</p>
            </div>
          ))}
          <div>
            <p className="font-bold">🔍 놓친 반박</p>
            <ul className="list-disc pl-5">{data.feedback.missed.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
          <div>
            <p className="font-bold">🌱 다음 토론에서 해 볼 것</p>
            <ul className="list-disc pl-5">{data.feedback.suggestions.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        </section>
      )}
    </main>
  );
}
