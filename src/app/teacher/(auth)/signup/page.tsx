"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", inviteCode: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/teacher/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "가입하지 못했습니다.");
      return;
    }
    router.push("/teacher");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 py-10">
      <h1 className="text-2xl font-bold">선생님 가입</h1>
      <p className="-mt-3 text-sm text-gray-500">운영자에게 받은 초대 코드가 있어야 가입할 수 있습니다.</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input value={form.name} onChange={set("name")} required placeholder="이름"
          className="rounded-xl border-2 border-gray-200 px-4 py-3 outline-none focus:border-blue-500" />
        <input type="email" value={form.email} onChange={set("email")} required placeholder="이메일" autoComplete="email"
          className="rounded-xl border-2 border-gray-200 px-4 py-3 outline-none focus:border-blue-500" />
        <input type="password" value={form.password} onChange={set("password")} required minLength={8}
          placeholder="비밀번호 (8자 이상)" autoComplete="new-password"
          className="rounded-xl border-2 border-gray-200 px-4 py-3 outline-none focus:border-blue-500" />
        <input value={form.inviteCode} onChange={set("inviteCode")} required placeholder="초대 코드"
          className="rounded-xl border-2 border-gray-200 px-4 py-3 outline-none focus:border-blue-500" />
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy}
          className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white disabled:bg-gray-300">
          {busy ? "가입 중..." : "가입하기"}
        </button>
      </form>
      <p className="text-center text-sm text-gray-500">
        이미 계정이 있나요? <Link href="/teacher/login" className="underline">로그인</Link>
      </p>
    </main>
  );
}
