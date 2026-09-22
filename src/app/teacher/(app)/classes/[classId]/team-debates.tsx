"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ArchiveButton from "../../archive-button";
import {
  DEFAULT_STAGE_SECONDS,
  PHASE_LABEL,
  STAGE_MINUTES_MAX,
  STAGE_MINUTES_MIN,
  STAGE_PHASES,
  TURN_SECONDS_DEFAULT,
  TURN_SECONDS_MAX,
  TURN_SECONDS_MIN,
  defaultScoreVisibility,
  type StagePhase,
  type TeamPhase,
} from "@/lib/team/rules";

export interface TeamDebateItem {
  id: string;
  topic: string;
  grade_level: number;
  status: "draft" | "open" | "closed";
  phase: TeamPhase;
  pro_name: string;
  con_name: string;
}

const STATUS_LABEL = { draft: "준비 중", open: "진행 중", closed: "끝남" } as const;

const defaultMinutes = () =>
  Object.fromEntries(STAGE_PHASES.map((p) => [p, DEFAULT_STAGE_SECONDS[p] / 60])) as Record<StagePhase, number>;

/**
 * 학급 상세의 "팀 토론" 칸 (ver2 V-R1).
 * 만들기 양식은 기본값(찬성팀/반대팀, 3·8·8·8·6분, 60초)으로 채워져 있다.
 */
export default function TeamDebatesSection({
  classId,
  gradeLevel,
  items,
  onChange,
  onError,
}: {
  classId: string;
  gradeLevel: number;
  items: TeamDebateItem[];
  onChange: () => void;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [proName, setProName] = useState("찬성팀");
  const [conName, setConName] = useState("반대팀");
  const [minutes, setMinutes] = useState<Record<StagePhase, number>>(defaultMinutes);
  const [turnSeconds, setTurnSeconds] = useState(TURN_SECONDS_DEFAULT);
  const [visibility, setVisibility] = useState<"live" | "after_end">(defaultScoreVisibility(gradeLevel));
  const [balance, setBalance] = useState(false);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    onError(null);
    const res = await fetch("/api/team-debates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        classId,
        topic,
        description: description || null,
        proName,
        conName,
        stageMinutes: minutes,
        turnSeconds,
        scoreVisibility: visibility,
        speakerBalance: balance,
      }),
    });
    setBusy(false);
    const body = (await res.json().catch(() => ({}))) as { error?: string; debate?: { id: string } };
    if (!res.ok || !body.debate) { onError(body.error ?? "만들지 못했습니다."); return; }
    router.push(`/teacher/team-debates/${body.debate.id}/setup`);
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-4 border-b border-emerald-100 bg-emerald-50 px-5 py-5 sm:px-6">
        <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-2xl text-white">👥</span>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-emerald-950">팀 토론</h2>
          <p className="text-sm text-emerald-800">찬성팀과 반대팀이 차례로 발언하고 AI가 심판을 봅니다.</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-emerald-800">{items.length}개</span>
      </div>
      <div className="p-5 sm:p-6">
      <h3 className="mb-3 text-sm font-bold text-gray-700">만든 팀 토론</h3>
      <ul className="mb-5 flex flex-col gap-2">
        {items.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="min-w-0 flex-1">
              <p className="font-bold">{d.topic}</p>
              <p className="text-xs text-gray-500">
                <span className={`mr-2 inline-block rounded-full px-2 py-0.5 font-bold ${d.status === "open" ? "bg-green-100 text-green-800" : d.status === "draft" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-700"}`}>{STATUS_LABEL[d.status]}</span>
                {d.status === "open" ? `${PHASE_LABEL[d.phase]} · ` : ""}초등 {d.grade_level}학년 · {d.pro_name} vs {d.con_name}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {d.status === "draft" && (
                <button onClick={() => router.push(`/teacher/team-debates/${d.id}/setup`)}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white">설정·팀 배정</button>
              )}
              {d.status !== "draft" && (
                <button onClick={() => router.push(`/teacher/team-debates/${d.id}`)}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-bold text-white">관제실</button>
              )}
              {d.status === "closed" && (
                <button onClick={() => router.push(`/teacher/team-debates/${d.id}/report`)}
                  className="rounded-lg border px-3 py-1.5 text-sm">결과 보고서</button>
              )}
              {d.status !== "open" && <ArchiveButton url={`/api/team-debates/${d.id}`} onDone={onChange} />}
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/50 p-5 text-center text-sm text-gray-600">아직 만든 팀 토론이 없습니다.</li>}
      </ul>

      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 sm:p-5">
        <h3 className="mb-1 font-bold text-emerald-950">새 팀 토론 만들기</h3>
        <p className="mb-4 text-sm text-emerald-800">팀 이름과 단계별 시간을 정한 뒤 학생을 배정할 수 있습니다.</p>
        <div className="flex flex-col gap-2">
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={100}
            placeholder="토론 주제 (예: 초등학생에게 스마트폰을 허용해야 한다)"
            className="rounded-xl border-2 border-gray-200 px-4 py-2 outline-none focus:border-blue-500" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300}
            placeholder="보충 설명 (선택)"
            className="rounded-xl border-2 border-gray-200 px-4 py-2 outline-none focus:border-blue-500" />
          <div className="flex flex-wrap gap-2 text-sm">
            <label className="flex items-center gap-1">찬성 팀 이름
              <input value={proName} onChange={(e) => setProName(e.target.value)} maxLength={20}
                className="w-28 rounded-lg border-2 border-gray-200 px-2 py-1" />
            </label>
            <label className="flex items-center gap-1">반대 팀 이름
              <input value={conName} onChange={(e) => setConName(e.target.value)} maxLength={20}
                className="w-28 rounded-lg border-2 border-gray-200 px-2 py-1" />
            </label>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {STAGE_PHASES.map((p) => (
              <label key={p} className="flex items-center gap-1">
                {PHASE_LABEL[p]}
                <input type="number" min={STAGE_MINUTES_MIN} max={STAGE_MINUTES_MAX} value={minutes[p]}
                  onChange={(e) => setMinutes((m) => ({ ...m, [p]: Number(e.target.value) }))}
                  className="w-16 rounded-lg border-2 border-gray-200 px-2 py-1" />분
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-1">발언 제한
              <input type="number" min={TURN_SECONDS_MIN} max={TURN_SECONDS_MAX} value={turnSeconds}
                onChange={(e) => setTurnSeconds(Number(e.target.value))}
                className="w-20 rounded-lg border-2 border-gray-200 px-2 py-1" />초
            </label>
            <label className="flex items-center gap-1">학생 점수 공개
              <select value={visibility} onChange={(e) => setVisibility(e.target.value as "live" | "after_end")}
                className="rounded-lg border-2 border-gray-200 px-2 py-1">
                <option value="after_end">결과 공개 뒤에만</option>
                <option value="live">토론 중 실시간</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={balance} onChange={(e) => setBalance(e.target.checked)} />
              발언자 고르게 (2번 말한 학생은 차례 첫 15초 동안 기다리기)
            </label>
          </div>
          <button onClick={create} disabled={busy || topic.trim().length === 0}
            className="self-start rounded-xl bg-blue-600 px-5 py-2 font-bold text-white disabled:bg-gray-300">
            팀 토론 만들기
          </button>
        </div>
      </div>
      </div>
    </section>
  );
}
