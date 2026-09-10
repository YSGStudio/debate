"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface LookupData {
  class: { id: string; name: string; gradeLevel: number };
  students: { id: string; name: string }[];
  sessions: { id: string; topic: string; description: string | null }[];
}

export default function PickNamePage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();
  const router = useRouter();
  const [data, setData] = useState<LookupData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/join/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? "코드를 다시 확인해 주세요.");
        setData(body as LookupData);
      })
      .catch((e: Error) => setError(e.message));
  }, [code]);

  async function pick(studentId: string) {
    setBusyId(studentId);
    const res = await fetch("/api/join/enter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, studentId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "다시 시도해 주세요.");
      setBusyId(null);
      return;
    }
    router.push("/debate");
  }

  if (error) {
    return (
      <main className="student-scope mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
        <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>
        <button onClick={() => router.push("/join")} className="rounded-2xl bg-gray-200 px-6 py-4 font-bold">
          코드 다시 넣기
        </button>
      </main>
    );
  }

  if (!data) {
    return <main className="student-scope p-8 text-gray-500">불러오는 중...</main>;
  }

  return (
    <main className="student-scope mx-auto max-w-2xl px-5 py-10">
      <div className="mb-7 text-center">
        <div className="mascot-bubble mb-3 text-5xl" aria-hidden="true">🙋</div>
        <span className="kid-badge">2단계 · 내 이름 찾기</span>
        <h1 className="mt-3 text-2xl font-bold">{data.class.name}</h1>
        <p className="mt-1 text-gray-600">아래에서 내 이름을 눌러요.</p>
      </div>

      {data.sessions.length === 0 && (
        <p className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-amber-800">
          아직 토론이 시작되지 않았어요. 선생님이 시작할 때까지 기다려요.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {data.students.map((s) => (
          <button
            key={s.id}
            onClick={() => pick(s.id)}
            disabled={busyId !== null}
            className="rounded-2xl border-2 border-gray-200 bg-white px-4 py-6 text-lg font-bold hover:-translate-y-1 hover:border-blue-400 hover:bg-blue-50 active:bg-blue-50 disabled:opacity-50"
          >
            {s.name}
          </button>
        ))}
      </div>
      {data.students.length === 0 && (
        <p className="text-gray-500">아직 명단이 없어요. 선생님께 말해주세요.</p>
      )}
    </main>
  );
}
