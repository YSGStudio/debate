"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/teacher/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "로그인하지 못했습니다.");
      return;
    }
    router.push("/teacher");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-bold">선생님 로그인</h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
          placeholder="이메일" autoComplete="email"
          className="rounded-xl border-2 border-gray-200 px-4 py-3 outline-none focus:border-blue-500"
        />
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
          placeholder="비밀번호" autoComplete="current-password"
          className="rounded-xl border-2 border-gray-200 px-4 py-3 outline-none focus:border-blue-500"
        />
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy}
          className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white disabled:bg-gray-300">
          {busy ? "로그인 중..." : "로그인"}
        </button>
      </form>
      <p className="text-center text-sm text-gray-500">
        초대 코드가 있나요? <Link href="/teacher/signup" className="underline">가입하기</Link>
      </p>
    </main>
  );
}
