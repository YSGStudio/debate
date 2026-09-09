"use client";

import { useState } from "react";

interface Props {
  /** PATCH 를 보낼 엔드포인트 (학급 또는 토론) */
  url: string;
  onDone: () => void;
  /** 보관 대신 되돌리기로 쓸 때 */
  mode?: "archive" | "restore";
  className?: string;
}

/**
 * 보관함으로 보내거나 되돌린다.
 *
 * 보관은 되돌릴 수 있으므로 확인 단계를 두지 않는다.
 * 되돌릴 수 없는 완전 삭제는 보관함에서 DeleteButton 이 맡는다.
 */
export default function ArchiveButton({ url, onDone, mode = "archive", className = "" }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: mode }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "실패했습니다.");
      return;
    }
    onDone();
  }

  const label = mode === "archive" ? "보관함으로" : "되돌리기";

  return (
    <div className={className}>
      <button
        onClick={run}
        disabled={busy}
        className={
          mode === "archive"
            ? "rounded-lg border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            : "rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white disabled:bg-gray-300"
        }
      >
        {busy ? "처리 중..." : label}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
