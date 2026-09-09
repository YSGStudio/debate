"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Coach, { type CoachFeedback } from "./coach";

interface Msg { role: "student" | "bot"; content: string }

interface State {
  openSessions: { id: string; topic: string; description: string | null }[];
  session: { id: string; topic: string; description: string | null; gradeLevel: number; status: string; messageLimit: number } | null;
  participation: { id: string; stance: "pro" | "con"; messageCount: number } | null;
  messages: Msg[];
  coach: CoachFeedback | null;
  locked: boolean;
  lockReason: "closed" | "limit" | null;
}

const MAX_LEN = 500;

export default function DebatePage() {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [stance, setStance] = useState<"pro" | "con" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [lockReason, setLockReason] = useState<"closed" | "limit" | null>(null);
  const [count, setCount] = useState(0);
  const [coach, setCoach] = useState<CoachFeedback | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 학생이 닫은 안내를 다시 띄우지 않기 위해 기억한다
  const dismissedRef = useRef<string | null>(null);

  const applyCoach = useCallback((next: CoachFeedback | null) => {
    if (!next || next.kind === "none") return;
    if (dismissedRef.current === next.messageId) return;
    setCoach(next);
  }, []);

  const load = useCallback(async (sid: string | null) => {
    const url = sid ? `/api/debate/state?sessionId=${sid}` : "/api/debate/state";
    const res = await fetch(url);
    if (res.status === 401) { router.push("/join"); return null; }
    const body = (await res.json()) as State;
    setState(body);
    if (body.session) setSessionId(body.session.id);
    if (body.participation) {
      setMessages(body.messages);
      setCount(body.participation.messageCount);
    }
    setLocked(body.locked);
    setLockReason(body.lockReason);
    applyCoach(body.coach);
    return body;
  }, [router, applyCoach]);

  // 최초 로드. 타이머 콜백에서 상태를 갱신한다.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { if (alive) void load(null); }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [load]);

  // 세션 종료를 감지하기 위한 상태 폴링 (R22). 5초 간격이면 10초 안에 잠긴다.
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    const t = setInterval(async () => {
      if (busy) return;
      const res = await fetch(`/api/debate/state?sessionId=${sessionId}`);
      if (!res.ok || !alive) return;
      const body = (await res.json()) as State;
      if (!alive) return;
      setLocked(body.locked);
      setLockReason(body.lockReason);
    }, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [sessionId, busy]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function start() {
    if (!sessionId || !stance) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/debate/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, stance }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "다시 시도해 주세요.");
      setBusy(false);
      return;
    }
    await load(sessionId);

    // 첫 인사는 챗봇이 건넨다. 학생 메시지를 만들지 않으므로 상한을 깎지 않는다.
    const open = await fetch("/api/debate/opening", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (open.ok && open.body) {
      const reader = open.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setStreaming(acc);
      }
      setMessages([{ role: "bot", content: acc }]);
      setStreaming("");
    }
    setBusy(false);
  }

  async function send(text: string) {
    if (!sessionId || busy || locked) return;
    const content = text.trim();
    if (!content) return;

    setBusy(true);
    setError(null);
    setMessages((m) => [...m, { role: "student", content }]);
    setInput("");
    setStreaming("");

    const res = await fetch("/api/debate/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, content }),
    });

    if (!res.ok || !res.body) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "다시 시도해 주세요.");
      if (b.locked) { setLocked(true); setLockReason(b.lockReason ?? "closed"); }
      setMessages((m) => m.slice(0, -1));
      setInput(content);
      setBusy(false);
      return;
    }

    const newCount = Number(res.headers.get("x-message-count") ?? count + 1);
    const limit = Number(res.headers.get("x-message-limit") ?? state?.session?.messageLimit ?? 30);
    setCount(newCount);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      setStreaming(acc);
    }
    setMessages((m) => [...m, { role: "bot", content: acc }]);
    setStreaming("");
    setBusy(false);

    // 판정은 응답 뒤에서 돌기 때문에 방금 보낸 말의 안내가 아직 없을 수 있다.
    // 정기 폴링(5초)보다 촘촘히 몇 번만 확인한다.
    for (const delay of [800, 1600, 2600, 4000]) {
      await new Promise((r) => setTimeout(r, delay));
      const st = await fetch(`/api/debate/state?sessionId=${sessionId}`);
      if (!st.ok) break;
      const body = (await st.json()) as State;
      if (body.coach && body.coach.kind !== "none") { applyCoach(body.coach); break; }
    }

    if (newCount >= limit) { setLocked(true); setLockReason("limit"); }
  }

  if (!state) return <main className="student-scope p-8 text-gray-500">불러오는 중...</main>;

  // 열린 토론이 없을 때
  if (!state.session) {
    return (
      <main className="student-scope mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
        <p className="text-xl font-bold">아직 토론이 시작되지 않았어요</p>
        <p className="text-gray-600">선생님이 시작하면 여기에 주제가 보여요.</p>
        <button onClick={() => load(null)} className="rounded-2xl bg-gray-200 px-6 py-4 font-bold">
          다시 확인하기
        </button>
      </main>
    );
  }

  // 열린 토론이 여러 개면 학생이 고른다 (R12)
  if (!state.participation && state.openSessions.length > 1 && !sessionId) {
    return (
      <main className="student-scope mx-auto max-w-md px-6 py-12">
        <h1 className="mb-4 text-xl font-bold">어떤 토론에 들어갈까요?</h1>
        <div className="flex flex-col gap-3">
          {state.openSessions.map((s) => (
            <button
              key={s.id}
              onClick={() => { setSessionId(s.id); void load(s.id); }}
              className="rounded-2xl border-2 border-gray-200 bg-white px-5 py-5 text-left text-lg font-bold"
            >
              {s.topic}
            </button>
          ))}
        </div>
      </main>
    );
  }

  // 찬반 선택 (R15)
  if (!state.participation) {
    return (
      <main className="student-scope mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
        <div>
          <p className="text-sm text-gray-500">오늘의 토론 주제</p>
          <h1 className="mt-1 text-2xl font-bold">{state.session.topic}</h1>
          {state.session.description && (
            <p className="mt-2 text-gray-600">{state.session.description}</p>
          )}
        </div>
        <p className="text-gray-700">너의 생각은 어느 쪽이야? 하나를 골라야 시작할 수 있어.</p>
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{error}</p>}
        <div className="flex gap-3">
          <button
            type="button"
            aria-pressed={stance === "pro"}
            onClick={() => setStance("pro")}
            disabled={busy}
            className={`flex-1 rounded-2xl border-4 px-4 py-8 text-xl font-bold ${
              stance === "pro"
                ? "border-blue-700 bg-blue-600 text-white"
                : "border-transparent bg-white text-blue-700"
            }`}
          >
            나는 찬성
          </button>
          <button
            type="button"
            aria-pressed={stance === "con"}
            onClick={() => setStance("con")}
            disabled={busy}
            className={`flex-1 rounded-2xl border-4 px-4 py-8 text-xl font-bold ${
              stance === "con"
                ? "border-orange-600 bg-orange-500 text-white"
                : "border-transparent bg-white text-orange-600"
            }`}
          >
            나는 반대
          </button>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={busy || stance === null}
          className="rounded-2xl bg-gray-900 px-6 py-5 text-xl font-bold text-white disabled:bg-gray-300"
        >
          {busy ? "준비 중..." : "시작하기"}
        </button>
        {stance === null && (
          <p className="text-center text-sm text-gray-500">찬성이나 반대를 먼저 골라줘.</p>
        )}
      </main>
    );
  }

  const limit = state.session.messageLimit;
  const stanceLabel = state.participation.stance === "pro" ? "찬성" : "반대";

  return (
    <main className="student-scope mx-auto flex h-dvh max-w-2xl flex-col">
      <header className="border-b bg-white px-5 py-3">
        <p className="text-xs text-gray-500">
          내 입장: <span className="font-bold">{stanceLabel}</span> · 말한 횟수 {count} / {limit}
        </p>
        <h1 className="text-base font-bold">{state.session.topic}</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "student" ? "mb-3 flex justify-end" : "mb-3 flex justify-start"}>
            <div
              className={
                m.role === "student"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-3 text-white"
                  : "max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="mb-3 flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm">
              {streaming}
            </div>
          </div>
        )}
        {busy && !streaming && <p className="text-sm text-gray-400">토론 친구가 생각하고 있어요...</p>}
        <div ref={bottomRef} />
      </div>

      {error && <p className="mx-4 mb-2 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {!locked && (
        <div className="px-4 pb-2">
          <Coach
            feedback={coach}
            idleHint="내 생각과 그렇게 생각한 이유를 함께 쓰면 점수가 올라가요."
            onDismiss={() => {
              if (coach) dismissedRef.current = coach.messageId;
              setCoach(null);
            }}
          />
        </div>
      )}

      {locked ? (
        <div className="border-t bg-white px-5 py-6 text-center">
          <p className="mb-3 text-lg font-bold">
            {lockReason === "limit" ? "오늘 토론은 여기까지예요" : "토론이 끝났어요"}
          </p>
          <button
            onClick={() => router.push(`/debate/result?sessionId=${sessionId}`)}
            className="w-full rounded-2xl bg-blue-600 px-6 py-4 text-lg font-bold text-white"
          >
            내 토론 점수 보기
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); void send(input); }}
          className="flex gap-2 border-t bg-white px-4 py-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_LEN))}
            disabled={busy}
            placeholder="내 생각을 써보자"
            className="flex-1 rounded-2xl border-2 border-gray-200 px-4 py-3 outline-none focus:border-blue-500 disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white disabled:bg-gray-300"
          >
            보내기
          </button>
        </form>
      )}
    </main>
  );
}
