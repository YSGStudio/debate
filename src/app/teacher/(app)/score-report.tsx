"use client";

import {
  ANALYSIS_LABEL,
  AREAS,
  BAND_BAR,
  BAND_CHIP,
  BAND_PANEL,
  BAND_TEXT,
  BASE_TOTAL_MAX,
  analysisBand,
  band,
  type AnalysisKey,
} from "@/lib/score-display";

export interface ScoreDetail {
  status: string;
  total: number | null;
  baseTotal: number | null;
  offTopicPenalty: number | null;
  scores: Record<string, number | null>;
  reasons: Record<string, string> | null;
  strengths: string[] | null;
  nextStep: string | null;
  analysis: { evidence: string; counter: string; shortAnswers: string; focus: string } | null;
  changeSummary: string | null;
  changeReason: string | null;
  error: string | null;
}

/**
 * 교사용 채점 결과.
 *
 * 좁은 사이드 패널(≈400px)에 들어가므로 라벨과 설명을 한 줄에 나란히 두지 않는다.
 * 영역마다 "라벨 + 점수" 한 줄, 막대, 그 아래 이유 순으로 쌓는다.
 * 교사가 약한 영역을 눈으로 먼저 찾아야 하므로 득점률에 따라 색을 입힌다.
 */
export default function ScoreReport({ score }: { score: ScoreDetail }) {
  const total = score.total ?? 0;
  const penalty = score.offTopicPenalty ?? 0;
  const totalBand = band(total, BASE_TOTAL_MAX);

  return (
    <div className="flex flex-col gap-3">
      {/* 최종 점수 */}
      <div className={`rounded-xl px-4 py-3 text-white ${BAND_PANEL[totalBand]}`}>
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-bold opacity-90">최종 점수</span>
          <span className="text-2xl font-bold">
            {total}
            <span className="ml-0.5 text-sm font-normal opacity-90">/ {BASE_TOTAL_MAX}</span>
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs opacity-90">
          <span>기본 {score.baseTotal ?? "-"}점</span>
          <span>{penalty < 0 ? `주제 이탈 ${penalty}점` : "감점 없음"}</span>
        </div>
      </div>

      {/* 영역별 */}
      <div className="rounded-xl border bg-white p-3">
        <p className="mb-2 text-xs font-bold text-gray-500">영역별 점수</p>
        <ul className="flex flex-col gap-3">
          {AREAS.map((a) => {
            const v = score.scores?.[a.key] ?? 0;
            const b = band(v, a.max);
            return (
              <li key={a.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-gray-800">{a.label}</span>
                  <span className={`shrink-0 text-sm font-bold ${BAND_TEXT[b]}`}>
                    {v}
                    <span className="font-normal text-gray-400"> / {a.max}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${BAND_BAR[b]}`}
                    style={{ width: `${a.max > 0 ? Math.round((v / a.max) * 100) : 0}%` }}
                  />
                </div>
                {score.reasons?.[a.key] && (
                  <p className="mt-1 text-xs leading-relaxed text-gray-600">{score.reasons[a.key]}</p>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* 주제 이탈 감점 */}
      {penalty < 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
          <p className="text-xs font-bold text-orange-800">주제 이탈 {penalty}점</p>
          {score.reasons?.offTopic && (
            <p className="mt-1 text-xs leading-relaxed text-orange-900">{score.reasons.offTopic}</p>
          )}
        </div>
      )}

      {/* 참여 분석 */}
      {score.analysis && (
        <div className="rounded-xl border bg-white p-3">
          <p className="mb-2 text-xs font-bold text-gray-500">토론 참여 분석</p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(ANALYSIS_LABEL) as AnalysisKey[]).map((k) => {
              const value = score.analysis![k];
              return (
                <div
                  key={k}
                  className={`rounded-lg border px-2 py-1.5 ${BAND_CHIP[analysisBand(k, value)]}`}
                >
                  <p className="text-[11px] opacity-80">{ANALYSIS_LABEL[k]}</p>
                  <p className="text-xs font-bold">{value}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 생각의 변화 */}
      {score.changeSummary && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
          <p className="text-xs font-bold text-violet-800">생각의 변화</p>
          <p className="mt-0.5 text-sm font-bold text-violet-900">{score.changeSummary}</p>
          {score.changeReason && (
            <p className="mt-1 text-xs leading-relaxed text-violet-900/80">{score.changeReason}</p>
          )}
        </div>
      )}

      {/* 피드백 */}
      {score.strengths && score.strengths.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="mb-1 text-xs font-bold text-emerald-800">잘한 점</p>
          <ul className="flex list-inside list-disc flex-col gap-0.5 text-xs leading-relaxed text-emerald-900">
            {score.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {score.nextStep && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-1 text-xs font-bold text-amber-800">더 발전시키면 좋은 점</p>
          <p className="text-xs leading-relaxed text-amber-900">{score.nextStep}</p>
        </div>
      )}
    </div>
  );
}
