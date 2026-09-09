"use client";

import { useState } from "react";

interface Impact {
  className?: string;
  topic?: string;
  studentCount?: number;
  sessionCount?: number;
  joinedStudents?: number;
  openTopics?: string[];
  messageCount: number;
  scoredCount: number;
}

interface Props {
  /** 미리보기와 삭제에 모두 쓰는 엔드포인트 (?preview=1 을 붙여 미리보기) */
  url: string;
  /** 지우려는 것의 이름 (확인 문구에 쓴다) */
  label: string;
  /** 삭제 성공 후 */
  onDeleted: () => void;
  className?: string;
}

/**
 * 두 단계 삭제 버튼.
 *
 * 누르면 먼저 서버에 무엇이 사라지는지 물어보고, 그 결과를 보여준 뒤에만 지운다.
 * 대화 기록이 있는 경우 되돌릴 수 없으므로 숫자를 눈으로 확인시키는 것이 핵심이다.
 */
export default function DeleteButton({ url, label, onDeleted, className = "" }: Props) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function preview() {
    setBusy(true);
    setError(null);
    const res = await fetch(`${url}?preview=1`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "확인하지 못했습니다.");
      return;
    }
    setImpact(((await res.json()) as { impact: Impact }).impact);
  }

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "지우지 못했습니다.");
      return;
    }
    setImpact(null);
    onDeleted();
  }

  if (!impact) {
    return (
      <div className={className}>
        <button
          onClick={preview}
          disabled={busy}
          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {busy ? "확인 중..." : "삭제"}
        </button>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  const hasData = impact.messageCount > 0;
  const openBlocked = (impact.openTopics?.length ?? 0) > 0;

  return (
    <div className={`rounded-xl border-2 border-red-300 bg-red-50 p-3 ${className}`}>
      <p className="font-bold text-red-900">&ldquo;{label}&rdquo; 을(를) 지울까요?</p>

      <ul className="mt-1 text-sm text-red-900">
        {impact.studentCount !== undefined && <li>· 학생 {impact.studentCount}명</li>}
        {impact.sessionCount !== undefined && <li>· 토론 {impact.sessionCount}개</li>}
        {impact.joinedStudents !== undefined && <li>· 참여한 학생 {impact.joinedStudents}명</li>}
        <li>· 대화 {impact.messageCount}건</li>
        {impact.scoredCount > 0 && <li>· 채점 결과 {impact.scoredCount}건</li>}
      </ul>

      {hasData && (
        <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm text-red-800">
          되돌릴 수 없습니다. 기록이 필요하면 먼저 <strong>PDF를 내려받으세요.</strong>
        </p>
      )}

      {openBlocked && (
        <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm text-red-800">
          진행 중인 토론이 있습니다: &ldquo;{impact.openTopics?.[0]}&rdquo;. 먼저 종료해 주세요.
        </p>
      )}

      {error && <p className="mt-2 text-sm font-bold text-red-800">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => { setImpact(null); setError(null); }}
          className="rounded-lg border bg-white px-3 py-1.5 text-sm font-bold"
        >
          취소
        </button>
        <button
          onClick={confirmDelete}
          disabled={busy || openBlocked}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white disabled:bg-gray-300"
        >
          {busy ? "지우는 중..." : hasData ? "그래도 지우기" : "지우기"}
        </button>
      </div>
    </div>
  );
}
