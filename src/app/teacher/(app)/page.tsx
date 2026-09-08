"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GRADE_LEVELS, DEFAULT_GRADE } from "@/lib/grade-presets";

interface ClassRow {
  id: string;
  name: string;
  grade_level: number;
  join_code: string;
  single_active_session: boolean;
}

export default function TeacherHome() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState<number>(DEFAULT_GRADE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/classes");
    if (res.ok) setClasses(((await res.json()) as { classes: ClassRow[] }).classes);
  }
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { if (alive) void load(); }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/classes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, gradeLevel: grade }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "만들지 못했습니다.");
      return;
    }
    setName("");
    await load();
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-xl font-bold">우리 반</h1>
        {classes.length === 0 ? (
          <p className="text-gray-500">아직 학급이 없습니다. 아래에서 만들어 주세요.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {classes.map((c) => (
              <li key={c.id}>
                <Link href={`/teacher/classes/${c.id}`}
                  className="block rounded-2xl border bg-white p-5 hover:border-blue-400">
                  <p className="text-lg font-bold">{c.name}</p>
                  <p className="text-sm text-gray-500">초등 {c.grade_level}학년</p>
                  <p className="mt-2 font-mono text-2xl tracking-widest">{c.join_code}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="mb-3 font-bold">학급 만들기</h2>
        <form onSubmit={create} className="flex flex-wrap items-center gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="예: 4학년 2반"
            className="flex-1 rounded-xl border-2 border-gray-200 px-4 py-2 outline-none focus:border-blue-500" />
          <label className="flex items-center gap-2 text-sm">
            학년
            <select value={grade} onChange={(e) => setGrade(Number(e.target.value))}
              className="rounded-xl border-2 border-gray-200 px-3 py-2">
              {GRADE_LEVELS.map((g) => <option key={g} value={g}>{g}학년</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy}
            className="rounded-xl bg-blue-600 px-5 py-2 font-bold text-white disabled:bg-gray-300">
            만들기
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </section>
    </div>
  );
}
