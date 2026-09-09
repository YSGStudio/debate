"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GRADE_LEVELS } from "@/lib/grade-presets";
import DeleteButton from "../../delete-button";

interface ClassRow {
  id: string; name: string; grade_level: number; join_code: string; single_active_session: boolean;
}
interface StudentRow { id: string; display_name: string; is_active: boolean }
interface SessionRow {
  id: string; topic: string; description: string | null; grade_level: number;
  status: "draft" | "open" | "closed"; message_limit: number;
}

const STATUS_LABEL = { draft: "준비 중", open: "진행 중", closed: "끝남" } as const;

export default function ClassPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();
  const [data, setData] = useState<{ class: ClassRow; students: StudentRow[]; sessions: SessionRow[] } | null>(null);
  const [roster, setRoster] = useState("");
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [limit, setLimit] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/classes/${classId}`);
    if (res.status === 404) { setError("찾을 수 없습니다."); return; }
    if (res.ok) setData(await res.json());
  }, [classId]);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { if (alive) void load(); }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [load]);

  async function call(url: string, body?: unknown, method = "POST") {
    setError(null); setNotice(null);
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const parsed = await res.json().catch(() => ({}));
    if (!res.ok) { setError((parsed as { error?: string }).error ?? "실패했습니다."); return null; }
    await load();
    return parsed;
  }

  if (error && !data) return <p className="text-red-700">{error}</p>;
  if (!data) return <p className="text-gray-500">불러오는 중...</p>;

  const activeStudents = data.students.filter((s) => s.is_active);

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{data.class.name}</h1>
            <p className="text-sm text-gray-500">초등 {data.class.grade_level}학년 · 학생 {activeStudents.length}명</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">학급 코드</p>
            <p className="font-mono text-3xl tracking-widest">{data.class.join_code}</p>
            <button onClick={() => call(`/api/classes/${classId}/rotate-code`)}
              className="mt-1 text-xs text-gray-500 underline">코드 다시 만들기</button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t pt-4 text-sm">
          <label className="flex items-center gap-2">
            학년
            <select value={data.class.grade_level}
              onChange={(e) => call(`/api/classes/${classId}`, { gradeLevel: Number(e.target.value) }, "PATCH")}
              className="rounded-lg border-2 border-gray-200 px-2 py-1">
              {GRADE_LEVELS.map((g) => <option key={g} value={g}>{g}학년</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={data.class.single_active_session}
              onChange={(e) => call(`/api/classes/${classId}`, { singleActiveSession: e.target.checked }, "PATCH")} />
            한 번에 하나의 토론만 열기
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          학년을 바꿔도 이미 만든 토론에는 영향을 주지 않습니다. 새로 만드는 토론부터 적용됩니다.
        </p>

        <div className="mt-4 border-t pt-4">
          <DeleteButton
            url={`/api/classes/${classId}`}
            label={data.class.name}
            onDeleted={() => router.push("/teacher")}
          />
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="mb-3 font-bold">학생 명단</h2>
        {activeStudents.length > 0 && (
          <ul className="mb-4 flex flex-wrap gap-2">
            {activeStudents.map((s) => (
              <li key={s.id} className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm">
                {s.display_name}
                <button onClick={() => call(`/api/students/${s.id}`, undefined, "DELETE")}
                  className="text-gray-400 hover:text-red-600" aria-label={`${s.display_name} 삭제`}>×</button>
              </li>
            ))}
          </ul>
        )}
        <textarea value={roster} onChange={(e) => setRoster(e.target.value)} rows={4}
          placeholder={"이름을 줄바꿈으로 구분해 붙여넣으세요\n김하늘\n이바다"}
          className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 outline-none focus:border-blue-500" />
        <button
          onClick={async () => {
            const r = await call(`/api/classes/${classId}/students`, { mode: "bulk", raw: roster });
            if (r) { setRoster(""); setNotice(`${(r as { added: number }).added}명 등록했습니다.`); }
          }}
          className="mt-2 rounded-xl bg-blue-600 px-5 py-2 font-bold text-white">명단 등록</button>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="mb-3 font-bold">토론</h2>
        <ul className="mb-5 flex flex-col gap-2">
          {data.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
              <div>
                <p className="font-bold">{s.topic}</p>
                <p className="text-xs text-gray-500">
                  {STATUS_LABEL[s.status]} · 초등 {s.grade_level}학년 · 1인 {s.message_limit}회까지
                </p>
              </div>
              <div className="flex gap-2">
                {s.status === "draft" && (
                  <button onClick={() => call(`/api/sessions/${s.id}`, { action: "open" }, "PATCH")}
                    className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-bold text-white">토론 시작</button>
                )}
                {s.status === "open" && (
                  <button onClick={() => call(`/api/sessions/${s.id}`, { action: "close" }, "PATCH")}
                    className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-bold text-white">토론 종료</button>
                )}
                <button onClick={() => router.push(`/teacher/sessions/${s.id}`)}
                  className="rounded-lg border px-3 py-1.5 text-sm">대시보드</button>
                {s.status !== "open" && (
                  <DeleteButton
                    url={`/api/sessions/${s.id}`}
                    label={s.topic}
                    onDeleted={load}
                  />
                )}
              </div>
            </li>
          ))}
          {data.sessions.length === 0 && <li className="text-sm text-gray-500">아직 만든 토론이 없습니다.</li>}
        </ul>

        <div className="border-t pt-4">
          <h3 className="mb-2 text-sm font-bold">새 토론 만들기</h3>
          <div className="flex flex-col gap-2">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={100}
              placeholder="토론 주제 (예: 숙제는 없어져야 한다)"
              className="rounded-xl border-2 border-gray-200 px-4 py-2 outline-none focus:border-blue-500" />
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300}
              placeholder="보충 설명 (선택)"
              className="rounded-xl border-2 border-gray-200 px-4 py-2 outline-none focus:border-blue-500" />
            <label className="text-sm text-gray-600">
              학생 1인당 말할 수 있는 횟수
              <input type="number" min={3} max={100} value={limit} onChange={(e) => setLimit(Number(e.target.value))}
                className="ml-2 w-20 rounded-lg border-2 border-gray-200 px-2 py-1" />
            </label>
            <button
              onClick={async () => {
                const r = await call("/api/sessions", { classId, topic, description: description || null, messageLimit: limit });
                if (r) { setTopic(""); setDescription(""); }
              }}
              disabled={topic.trim().length === 0}
              className="self-start rounded-xl bg-blue-600 px-5 py-2 font-bold text-white disabled:bg-gray-300">
              만들기
            </button>
          </div>
        </div>
      </section>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      {notice && <p className="rounded-xl bg-green-50 px-4 py-3 text-green-800">{notice}</p>}
      <Link href="/teacher" className="text-sm text-gray-500 underline">← 학급 목록</Link>
    </div>
  );
}
