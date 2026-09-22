"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ArchiveButton from "../archive-button";
import DeleteButton from "../delete-button";

interface ClassRow {
  id: string;
  name: string;
  grade_level: number;
  join_code: string;
  archived_at: string | null;
}
interface SessionRow {
  id: string;
  topic: string;
  grade_level: number;
  status: "draft" | "open" | "closed";
  archived_at: string | null;
  class_name: string;
}

interface TeamDebateRow {
  id: string;
  topic: string;
  grade_level: number;
  status: "draft" | "open" | "closed";
  archived_at: string | null;
  class_name: string;
}

const STATUS_LABEL = { draft: "준비 중", open: "진행 중", closed: "끝남" } as const;

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 보관`;
}

export default function ArchivePage() {
  const [data, setData] = useState<{ classes: ClassRow[]; sessions: SessionRow[]; teamDebates?: TeamDebateRow[] } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/archive");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { if (alive) void load(); }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [load]);

  if (!data) return <p className="text-gray-500">불러오는 중...</p>;

  const teamDebates = data.teamDebates ?? [];
  const empty = data.classes.length === 0 && data.sessions.length === 0 && teamDebates.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-bold">📦 보관함</h1>
        <p className="mt-1 text-sm text-gray-600">
          보관한 토론입니다. 되돌리면 다시 목록에 나타납니다.
          보관된 토론의 코드로는 학생이 들어올 수 없습니다.
        </p>
      </div>

      {empty && (
        <p className="rounded-2xl border bg-white p-8 text-center text-gray-500">
          보관함이 비어 있습니다.
        </p>
      )}

      {data.classes.length > 0 && (
        <section>
          <h2 className="mb-3 font-bold">토론 {data.classes.length}개</h2>
          <ul className="flex flex-col gap-3">
            {data.classes.map((c) => (
              <li key={c.id} className="rounded-2xl border bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold">{c.name}</p>
                    <p className="text-sm text-gray-500">
                      초등 {c.grade_level}학년 · 코드 {c.join_code} · {when(c.archived_at)}
                    </p>
                  </div>
                  <ArchiveButton url={`/api/classes/${c.id}`} mode="restore" onDone={load} />
                </div>
                <DeleteButton
                  url={`/api/classes/${c.id}`}
                  label={c.name}
                  onDeleted={load}
                  className="mt-3"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.sessions.length > 0 && (
        <section>
          <h2 className="mb-3 font-bold">개인 토론 {data.sessions.length}개</h2>
          <ul className="flex flex-col gap-3">
            {data.sessions.map((s) => (
              <li key={s.id} className="rounded-2xl border bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold">{s.topic}</p>
                    <p className="text-sm text-gray-500">
                      {s.class_name} · 초등 {s.grade_level}학년 · {STATUS_LABEL[s.status]} ·{" "}
                      {when(s.archived_at)}
                    </p>
                  </div>
                  <ArchiveButton url={`/api/sessions/${s.id}`} mode="restore" onDone={load} />
                </div>
                <DeleteButton
                  url={`/api/sessions/${s.id}`}
                  label={s.topic}
                  onDeleted={load}
                  className="mt-3"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {teamDebates.length > 0 && (
        <section>
          <h2 className="mb-3 font-bold">팀 토론 {teamDebates.length}개</h2>
          <ul className="flex flex-col gap-3">
            {teamDebates.map((d) => (
              <li key={d.id} className="rounded-2xl border bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold">👥 {d.topic}</p>
                    <p className="text-sm text-gray-500">
                      {d.class_name} · 초등 {d.grade_level}학년 · {STATUS_LABEL[d.status]} ·{" "}
                      {when(d.archived_at)}
                    </p>
                  </div>
                  <ArchiveButton url={`/api/team-debates/${d.id}`} mode="restore" onDone={load} />
                </div>
                <DeleteButton
                  url={`/api/team-debates/${d.id}`}
                  label={d.topic}
                  onDeleted={load}
                  className="mt-3"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href="/teacher" className="text-sm text-gray-500 underline">
        ← 토론 목록
      </Link>
    </div>
  );
}
