"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ArchiveButton from "../../archive-button";
import TeamDebatesSection, { type TeamDebateItem } from "./team-debates";
import EvidenceEditor from "./evidence-editor";
import type { EvidenceItem } from "@/lib/evidence";

interface ClassRow {
  id: string; name: string; grade_level: number; join_code: string; single_active_session: boolean;
}
interface StudentRow { id: string; display_name: string; is_active: boolean }
interface SessionRow {
  id: string; topic: string; description: string | null; grade_level: number;
  pro_claim: string | null; con_claim: string | null; evidence: EvidenceItem[];
  status: "draft" | "open" | "closed"; message_limit: number;
}

const STATUS_LABEL = { draft: "준비 중", open: "진행 중", closed: "끝남" } as const;

export default function ClassPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();
  const [data, setData] = useState<{ class: ClassRow; students: StudentRow[]; sessions: SessionRow[]; teamDebates?: TeamDebateItem[] } | null>(null);
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [limit, setLimit] = useState(30);
  const [proClaim, setProClaim] = useState("");
  const [conClaim, setConClaim] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  /** 근거 자료를 펼쳐 본 토론 */
  const [evidenceOpen, setEvidenceOpen] = useState<string | null>(null);
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

  /** 이미 만든 토론의 근거 자료를 고칠 때마다 바로 저장한다 */
  async function saveEvidence(sessionId: string, items: EvidenceItem[]) {
    await call(`/api/sessions/${sessionId}`, { action: "evidence", evidence: items }, "PATCH");
  }

  /** 찬반 주장 초안을 받아 입력칸에 채운다. 저장은 교사가 확인한 뒤 만들기에서 한다. */
  async function draftClaims() {
    setError(null); setNotice(null); setDrafting(true);
    const res = await fetch("/api/sessions/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic, description: description || null }),
    });
    const body = (await res.json().catch(() => ({}))) as { proClaim?: string; conClaim?: string; error?: string };
    setDrafting(false);
    if (!res.ok || !body.proClaim || !body.conClaim) {
      setError(body.error ?? "초안을 만들지 못했습니다. 직접 입력해 주세요.");
      return;
    }
    setProClaim(body.proClaim);
    setConClaim(body.conClaim);
  }

  if (error && !data) return <p className="text-red-700">{error}</p>;
  if (!data) return <p className="text-gray-500">불러오는 중...</p>;

  const activeStudents = data.students.filter((s) => s.is_active);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-blue-700">토론 관리</p>
            <h1 className="mt-1 text-2xl font-bold">{data.class.name}</h1>
            <p className="text-sm text-gray-500">초등 {data.class.grade_level}학년 · 학생 {activeStudents.length}명</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">토론 코드</p>
            <p className="font-mono text-3xl tracking-widest">{data.class.join_code}</p>
            <Link href="/teacher/settings"
              className="mt-1 inline-block text-sm font-bold text-blue-700 underline">학생 명단 환경설정</Link>
          </div>
        </div>
        <p className="mt-4 border-t pt-4 text-sm text-gray-600">
          환경설정에 등록한 학생 {activeStudents.length}명의 명단을 토론에서 불러옵니다.
        </p>
      </section>

      <section className="overflow-hidden rounded-3xl border border-blue-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-4 border-b border-blue-100 bg-blue-50 px-5 py-5 sm:px-6">
          <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-2xl text-white">💬</span>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-blue-950">개인 토론</h2>
            <p className="text-sm text-blue-800">학생이 AI 토론 친구와 일대일로 생각을 나눕니다.</p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-blue-800">{data.sessions.length}개</span>
        </div>
        <div className="p-5 sm:p-6">
        <h3 className="mb-3 text-sm font-bold text-gray-700">만든 개인 토론</h3>
        <ul className="mb-5 flex flex-col gap-2">
          {data.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{s.topic}</p>
                {s.pro_claim && s.con_claim && (
                  <p className="text-xs text-gray-600">
                    <span className="font-bold text-blue-700">찬성</span> {s.pro_claim}
                    <span className="mx-1.5 text-gray-300">|</span>
                    <span className="font-bold text-orange-600">반대</span> {s.con_claim}
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  <span className={`mr-2 inline-block rounded-full px-2 py-0.5 font-bold ${s.status === "open" ? "bg-green-100 text-green-800" : s.status === "draft" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-700"}`}>{STATUS_LABEL[s.status]}</span>
                  초등 {s.grade_level}학년 · 1인 {s.message_limit}회까지
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {s.status === "draft" && (
                  <button onClick={() => call(`/api/sessions/${s.id}`, { action: "open" }, "PATCH")}
                    className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-bold text-white">토론 시작</button>
                )}
                {s.status === "open" && (
                  <button onClick={() => call(`/api/sessions/${s.id}`, { action: "close" }, "PATCH")}
                    className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-bold text-white">토론 종료</button>
                )}
                <button onClick={() => setEvidenceOpen(evidenceOpen === s.id ? null : s.id)}
                  aria-expanded={evidenceOpen === s.id}
                  className="rounded-lg border px-3 py-1.5 text-sm">📚 근거 자료 {(s.evidence ?? []).length}개</button>
                <button onClick={() => router.push(`/teacher/sessions/${s.id}`)}
                  className="rounded-lg border px-3 py-1.5 text-sm">대시보드</button>
                {s.status !== "open" && (
                  <ArchiveButton url={`/api/sessions/${s.id}`} onDone={load} />
                )}
              </div>
              {evidenceOpen === s.id && (
                <div className="basis-full">
                  <EvidenceEditor
                    classId={classId}
                    topic={s.topic}
                    description={s.description ?? ""}
                    proClaim={s.pro_claim ?? ""}
                    conClaim={s.con_claim ?? ""}
                    items={s.evidence ?? []}
                    onChange={(items) => saveEvidence(s.id, items)}
                    readOnly={s.status === "closed"}
                  />
                </div>
              )}
            </li>
          ))}
          {data.sessions.length === 0 && <li className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/50 p-5 text-center text-sm text-gray-600">아직 만든 개인 토론이 없습니다.</li>}
        </ul>

        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 sm:p-5">
          <h3 className="mb-1 font-bold text-blue-950">새 개인 토론 만들기</h3>
          <p className="mb-4 text-sm text-blue-800">주제와 발언 횟수를 정해 학생별 대화를 시작할 수 있습니다.</p>
          <div className="flex flex-col gap-2">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={100}
              placeholder="개인 토론 주제 (예: 숙제는 없어져야 한다)"
              className="rounded-xl border-2 border-gray-200 px-4 py-2 outline-none focus:border-blue-500" />
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300}
              placeholder="보충 설명 (선택)"
              className="rounded-xl border-2 border-gray-200 px-4 py-2 outline-none focus:border-blue-500" />
            <div className="rounded-xl border border-blue-100 bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-gray-700">찬성·반대가 각각 무엇을 주장하나요?</p>
                <button type="button" onClick={draftClaims} disabled={drafting || topic.trim().length === 0}
                  className="rounded-lg border border-blue-300 px-3 py-1.5 text-sm font-bold text-blue-700 disabled:border-gray-200 disabled:text-gray-400">
                  {drafting ? "만드는 중..." : "✨ AI 초안 만들기"}
                </button>
              </div>
              <p className="mb-2 text-xs text-gray-500">
                AI 토론 친구와 채점이 이 문장을 기준으로 입장을 나눕니다. 초안을 확인하고 필요하면 고쳐 주세요.
              </p>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <span className="w-10 shrink-0 font-bold text-blue-700">찬성</span>
                  <input value={proClaim} onChange={(e) => setProClaim(e.target.value)} maxLength={100}
                    placeholder="예: 숙제를 없애야 한다"
                    className="flex-1 rounded-xl border-2 border-gray-200 px-3 py-1.5 outline-none focus:border-blue-500" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <span className="w-10 shrink-0 font-bold text-orange-600">반대</span>
                  <input value={conClaim} onChange={(e) => setConClaim(e.target.value)} maxLength={100}
                    placeholder="예: 숙제는 계속 있어야 한다"
                    className="flex-1 rounded-xl border-2 border-gray-200 px-3 py-1.5 outline-none focus:border-blue-500" />
                </label>
              </div>
            </div>
            <EvidenceEditor
              classId={classId}
              topic={topic}
              description={description}
              proClaim={proClaim}
              conClaim={conClaim}
              items={evidence}
              onChange={setEvidence}
            />
            <label className="text-sm text-gray-600">
              학생 1인당 말할 수 있는 횟수
              <input type="number" min={3} max={100} value={limit} onChange={(e) => setLimit(Number(e.target.value))}
                className="ml-2 w-20 rounded-lg border-2 border-gray-200 px-2 py-1" />
            </label>
            <button
              onClick={async () => {
                const r = await call("/api/sessions", {
                  classId, topic, description: description || null, messageLimit: limit, proClaim, conClaim, evidence,
                });
                if (r) { setTopic(""); setDescription(""); setProClaim(""); setConClaim(""); setEvidence([]); }
              }}
              disabled={topic.trim().length === 0 || proClaim.trim().length === 0 || conClaim.trim().length === 0}
              className="self-start rounded-xl bg-blue-600 px-5 py-2 font-bold text-white disabled:bg-gray-300">
              개인 토론 만들기
            </button>
          </div>
        </div>
        </div>
      </section>

      <TeamDebatesSection
        classId={classId}
        gradeLevel={data.class.grade_level}
        items={data.teamDebates ?? []}
        onChange={load}
        onError={setError}
      />

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>}
      {notice && <p className="rounded-xl bg-green-50 px-4 py-3 text-green-800">{notice}</p>}
      <Link href="/teacher" className="text-sm text-gray-500 underline">← 토론 목록</Link>
    </div>
  );
}
