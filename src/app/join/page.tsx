"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { normalizeClassCode } from "@/lib/class-code";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const normalized = normalizeClassCode(code);
    const res = await fetch("/api/join/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: normalized }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "코드를 다시 확인해 주세요.");
      return;
    }
    router.push(`/join/${normalized}`);
  }

  return (
    <main className="student-scope mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-2xl font-bold">우리 반 코드를 넣어주세요</h1>
      <p className="text-gray-600">칠판에 적힌 숫자 6개를 그대로 쓰면 돼요.</p>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <input
          value={code}
          // 숫자만 받는다. 아이가 다른 키를 눌러도 화면에 남지 않게 한다.
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          maxLength={6}
          autoFocus
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          autoCorrect="off"
          placeholder="예: 123456"
          className="rounded-2xl border-2 border-gray-300 bg-white px-5 py-5 text-center text-3xl font-bold tracking-[0.3em] outline-none focus:border-blue-500"
        />
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy || code.trim().length < 6}
          className="rounded-2xl bg-blue-600 px-6 py-5 text-xl font-bold text-white disabled:bg-gray-300"
        >
          {busy ? "확인 중..." : "들어가기"}
        </button>
      </form>
    </main>
  );
}
