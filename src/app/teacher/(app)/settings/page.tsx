"use client";

import { useCallback, useEffect, useState } from "react";

interface Student { id: string; display_name: string }

export default function TeacherSettingsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/teacher/roster");
    if (res.ok) setStudents(((await res.json()) as { students: Student[] }).students);
    else setError("학생 명단을 불러오지 못했습니다.");
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function request(method: "POST" | "DELETE", body: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/teacher/roster", {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({})) as { error?: string; added?: number };
      if (!res.ok) { setError(result.error ?? "처리하지 못했습니다."); return false; }
      await load();
      return result;
    } catch {
      setError("연결을 확인하고 다시 시도해 주세요.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">환경설정</h1>
      <p className="mt-1 text-sm text-gray-600">여기에 등록한 학생 명단은 모든 토론에서 사용할 수 있습니다.</p>
      <section className="mt-5 rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-bold">학생 명단 · {students.length}명</h2>
        {students.length ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {students.map((student) => (
              <li key={student.id} className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm">
                <span>{student.display_name}</span>
                <button type="button" disabled={busy}
                  onClick={async () => { if (await request("DELETE", { id: student.id })) setNotice("명단에서 삭제했습니다."); }}
                  aria-label={`${student.display_name} 명단에서 삭제`}
                  className="font-bold text-gray-600 hover:text-red-700 disabled:opacity-50">×</button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-gray-600">등록된 학생이 없습니다.</p>}
        <label htmlFor="roster" className="mt-6 block text-sm font-bold">학생 이름 등록</label>
        <p className="mb-2 text-sm text-gray-600">한 줄에 한 명씩 입력하세요.</p>
        <textarea id="roster" rows={5} value={raw} onChange={(e) => setRaw(e.target.value)}
          placeholder={"김하늘\n이바다"}
          className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 focus:border-blue-500" />
        <button type="button" disabled={busy || !raw.trim()}
          onClick={async () => {
            const result = await request("POST", { raw });
            if (result) { setRaw(""); setNotice(`${result.added ?? 0}명 등록했습니다.`); }
          }}
          className="mt-3 rounded-xl bg-blue-600 px-5 py-2 font-bold text-white disabled:bg-gray-300">명단 등록</button>
      </section>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl bg-green-50 px-4 py-3 text-green-800">{notice}</p>}
    </main>
  );
}
