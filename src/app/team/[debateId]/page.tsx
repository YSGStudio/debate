"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  mmss,
  remainingMs,
  useNow,
  useTeamPoll,
  type PollMessage,
  type PollSnapshot,
} from "@/lib/team/poll-client";
import {
  CHAT_MAX_LEN,
  CLAIM_HEARTBEAT_MS,
  PHASE_GUIDE,
  PHASE_LABEL,
  SPEECH_MAX_LEN,
  TURN_WARNING_SECONDS,
  type Side,
} from "@/lib/team/rules";

const SIDE_STYLE: Record<Side, { bubble: string; chip: string; label: string }> = {
  pro: { bubble: "border-blue-300 bg-blue-50", chip: "bg-blue-600 text-white", label: "찬성" },
  con: { bubble: "border-orange-300 bg-orange-50", chip: "bg-orange-500 text-white", label: "반대" },
};

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string; holder?: string };
  return { ok: res.ok, status: res.status, ...json };
}

/**
 * 학생 팀 토론 화면 (ver2 V-R7, V-R15, V-R19~V-R29, V-R47).
 * 왼쪽 전체 토론방, 오른쪽 우리 팀 채팅. 768px 미만에서는 탭으로 바꾼다.
 */
export default function TeamDebatePage() {
  const { debateId } = useParams<{ debateId: string }>();
  const router = useRouter();
  const [entered, setEntered] = useState<"pending" | "ok" | "missing">("pending");
  const [floorInput, setFloorInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"floor" | "team">("floor");
  const [sending, setSending] = useState(false);
  const floorInputRef = useRef("");
  const lastClaimAt = useRef(0);
  const floorEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const now = useNow();

  const enter = useCallback(async () => {
    const r = await post("/api/team/enter", { debateId });
    if (r.status === 401) { router.push("/join"); return; }
    setEntered(r.ok ? "ok" : "missing");
  }, [debateId, router]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { if (alive) void enter(); }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [enter]);

  // 우리 차례였다가 보낼 수 없게 되면 쓰던 글을 팀 채팅에 남긴다 (V-R26)
  const onSnapshot = useCallback((snap: PollSnapshot, prev: PollSnapshot | null) => {
    const text = floorInputRef.current.trim();
    if (!text || !prev || !snap.me) return;
    const wasMine = prev.floorState === "open" && prev.turn?.side === snap.me.side;
    const isMine = snap.floorState === "open" && snap.turn?.side === snap.me.side && snap.turn?.id === prev.turn?.id;
    if (wasMine && !isMine) {
      floorInputRef.current = "";
      setFloorInput("");
      setNotice("차례가 넘어가서 쓰던 글을 우리 팀 채팅에 남겼어요.");
      void post("/api/team/chat", { debateId, content: text, draft: true });
    }
  }, [debateId]);

  const { snap, messages, error, refresh, reset } = useTeamPoll(
    entered === "ok" ? `/api/team/poll?debateId=${debateId}` : null,
    onSnapshot,
  );

  useEffect(() => {
    floorEndRef.current?.scrollIntoView({ block: "end" });
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // 입력하는 동안 3초마다 잠금을 연장한다 (V-R24)
  const claim = useCallback(async (force = false) => {
    const t = Date.now();
    if (!force && t - lastClaimAt.current < CLAIM_HEARTBEAT_MS) return;
    lastClaimAt.current = t;
    const r = await post("/api/team/claim", { debateId });
    if (!r.ok && r.error) setNotice(r.error);
    else setNotice(null);
  }, [debateId]);

  const hidden = useMemo(() => new Set(snap?.hiddenSeqs ?? []), [snap?.hiddenSeqs]);
  const scoreBySeq = useMemo(() => new Map((snap?.scores ?? []).map((s) => [s.seq, s])), [snap?.scores]);

  if (entered === "missing" || error?.status === 404) {
    return (
      <main className="student-scope mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
        <p className="text-xl font-bold">이 토론을 찾을 수 없어요</p>
        <p className="text-gray-600">선생님이 정해 준 팀 토론인지 확인해요.</p>
        <Link href="/debate" className="rounded-2xl bg-gray-200 px-6 py-4 font-bold">돌아가기</Link>
      </main>
    );
  }
  if (error?.status === 401) {
    return (
      <main className="student-scope mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
        <p className="text-xl font-bold">다시 입장해 주세요</p>
        <Link href="/join" className="rounded-2xl bg-blue-600 px-6 py-4 font-bold text-white">코드 넣으러 가기</Link>
      </main>
    );
  }
  // 다른 기기에서 들어왔다 (V-R9)
  if (error?.code === "replaced" || error?.code === "not_entered") {
    return (
      <main className="student-scope mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
        <div className="mascot-bubble text-5xl" aria-hidden="true">📱</div>
        <p className="text-xl font-bold">다른 기기에서 들어왔어요</p>
        <p className="text-gray-600">이 기기에서 계속하려면 아래 버튼을 눌러요. 다른 기기는 끊겨요.</p>
        <button
          onClick={async () => { reset(); await enter(); void refresh(); }}
          className="rounded-2xl bg-blue-600 px-6 py-4 font-bold text-white"
        >
          여기서 계속하기
        </button>
      </main>
    );
  }
  if (!snap || !snap.me) return <main className="student-scope p-8 text-gray-500">불러오는 중...</main>;

  const me = snap.me;
  const d = snap.debate;
  const names: Record<Side, string> = { pro: d.proName, con: d.conName };
  const myTeam = names[me.side];
  const teammates = snap.members;

  // 대기실 (V-R7)
  if (d.phase === "waiting") {
    return (
      <main className="student-scope mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-10">
        <span className="kid-badge self-start">팀 토론 · 대기실</span>
        <div>
          <p className="text-sm font-bold text-blue-700">📣 오늘의 토론 주제</p>
          <h1 className="mt-1 text-2xl font-bold">{d.topic}</h1>
          {d.description && <p className="mt-2 text-gray-600">{d.description}</p>}
        </div>
        <div className={`kid-card border-2 p-4 ${SIDE_STYLE[me.side].bubble}`}>
          <p className="font-bold">우리 팀: {myTeam} ({SIDE_STYLE[me.side].label})</p>
          <p className="mt-1 text-sm text-gray-700">{teammates.map((m) => m.name).join(", ")}</p>
        </div>
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-amber-800">선생님이 토론을 시작하면 열려요.</p>
      </main>
    );
  }

  const phaseLeft = remainingMs(d.phaseRemainingMs, snap, now);
  const turnLeft = remainingMs(snap.turn?.remainingMs, snap, now);
  const myTurn = snap.floorState === "open" && snap.turn?.side === me.side;
  const lockedByOther = myTurn && !!snap.turn?.lockMemberId && snap.turn.lockMemberId !== me.memberId;
  const canWriteFloor = myTurn && !lockedByOther;
  const chatOpen = d.status === "open" && d.phase !== "ended";
  const ended = d.phase === "ended";
  const warn = myTurn && turnLeft !== null && turnLeft <= TURN_WARNING_SECONDS * 1000 && turnLeft > 0;

  async function speak() {
    const content = floorInput.trim();
    if (!content || sending) return;
    setSending(true);
    const r = await post("/api/team/speak", { debateId, content });
    setSending(false);
    if (r.ok) {
      floorInputRef.current = "";
      setFloorInput("");
      setNotice(null);
      void refresh();
      return;
    }
    // 보낼 수 없게 됐으면 글을 잃지 않게 팀 채팅에 남긴다 (V-R26)
    if (r.code === "not_your_turn" || r.code === "closed") {
      floorInputRef.current = "";
      setFloorInput("");
      await post("/api/team/chat", { debateId, content, draft: true });
      setNotice("차례가 넘어가서 쓰던 글을 우리 팀 채팅에 남겼어요.");
    } else {
      setNotice(r.error ?? "다시 시도해 주세요.");
    }
    void refresh();
  }

  async function sendChat() {
    const content = chatInput.trim();
    if (!content) return;
    const r = await post("/api/team/chat", { debateId, content });
    if (r.ok) { setChatInput(""); setNotice(null); void refresh(); }
    else setNotice(r.error ?? "다시 시도해 주세요.");
  }

  function promote(text: string) {
    const t = text.slice(0, SPEECH_MAX_LEN);
    floorInputRef.current = t;
    setFloorInput(t);
    setTab("floor");
    void claim(true);
  }

  const floorMsgs = messages.filter((m) => m.channel === "floor");
  const teamMsgs = messages.filter((m) => m.channel === me.side);

  const floorState = snap.floorState;
  const floorHint =
    floorState === "team_only" ? "지금은 팀 채팅으로 작전을 짜요. 토론방은 잠겨 있어요."
    : floorState === "paused" ? "잠깐 멈췄어요. 선생님을 기다려요."
    : floorState === "time_up" ? "시간이 끝났어요. 선생님이 다음 단계를 열어요."
    : floorState === "final_done" ? "두 팀 모두 마지막 발언을 마쳤어요."
    : floorState === "closed" ? "토론이 끝났어요."
    : !myTurn ? `지금은 ${names[snap.turn?.side ?? "pro"]} 차례예요. 잘 듣고 다음 말을 준비해요.`
    : lockedByOther ? `${snap.turn?.lockName ?? "친구"} 친구가 쓰고 있어요.`
    : "우리 팀 차례예요! 먼저 쓰기 시작한 친구가 발언해요.";

  return (
    <main className="student-scope mx-auto flex min-h-dvh max-w-6xl flex-col gap-3 px-3 py-4 md:px-5">
      {/* 상단: 단계·남은 시간·차례 (V-R47) */}
      <header className="kid-card flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="kid-badge">{PHASE_LABEL[d.phase]} 단계</span>
            <p className="mt-1 text-sm text-gray-600">{PHASE_GUIDE[d.phase]}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">단계 남은 시간</p>
            <p className="font-mono text-2xl font-bold">{d.paused ? "멈춤" : mmss(phaseLeft)}</p>
          </div>
        </div>
        <p className="text-sm text-gray-700">
          주제: <strong>{d.topic}</strong> · 우리 팀 <strong>{myTeam}</strong>
        </p>
        {snap.turn && floorState === "open" && (
          <div>
            <p className={`font-bold ${myTurn ? "text-green-700" : "text-gray-700"}`}>
              지금은 {names[snap.turn.side]} 차례 {myTurn ? "— 우리 팀!" : ""}
            </p>
            <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-gray-200" aria-label="차례 남은 시간">
              <div
                className={`h-full ${warn ? "bg-red-500" : SIDE_STYLE[snap.turn.side].chip.split(" ")[0]}`}
                style={{ width: `${Math.min(100, ((turnLeft ?? 0) / (d.turnSeconds * 1000)) * 100)}%` }}
              />
            </div>
            {warn && <p className="mt-1 font-bold text-red-600">⏰ 10초 남았어요!</p>}
          </div>
        )}
        {d.paused && <p className="rounded-xl bg-amber-100 px-3 py-2 font-bold text-amber-900">잠깐 멈췄어요</p>}
        {snap.totals && (
          <p className="text-sm text-gray-600">
            점수판 · {names.pro} {snap.totals.pro} : {snap.totals.con} {names.con}
          </p>
        )}
        {ended && (
          <Link href={`/team/${debateId}/result`} className="rounded-xl bg-blue-600 px-4 py-3 text-center font-bold text-white">
            결과 보러 가기
          </Link>
        )}
      </header>

      {snap.announcement && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-3" role="status">
          <p className="text-xs font-bold text-amber-800">📌 선생님 공지</p>
          <p className="font-bold">{snap.announcement.content}</p>
        </div>
      )}

      {notice && <p className="rounded-xl bg-blue-50 px-4 py-2 text-blue-900">{notice}</p>}

      {/* 태블릿 세로: 탭 (V-R47) */}
      <div className="flex gap-2 md:hidden">
        <button
          onClick={() => setTab("floor")}
          className={`relative flex-1 rounded-xl px-3 py-2 font-bold ${tab === "floor" ? "bg-blue-600 text-white" : "bg-white"}`}
        >
          전체 토론방
          {myTurn && tab !== "floor" && (
            <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-2 text-xs text-white">우리 차례!</span>
          )}
        </button>
        <button
          onClick={() => setTab("team")}
          className={`flex-1 rounded-xl px-3 py-2 font-bold ${tab === "team" ? "bg-blue-600 text-white" : "bg-white"}`}
        >
          우리 팀 채팅
        </button>
      </div>

      <div className="grid flex-1 gap-3 md:grid-cols-2">
        {/* 전체 토론방 */}
        <section className={`kid-card flex min-h-[50vh] flex-col p-3 ${tab === "floor" ? "" : "hidden md:flex"} ${myTurn ? "ring-4 ring-green-300" : ""}`}>
          <h2 className="mb-2 font-bold">🏛️ 전체 토론방</h2>
          <ul className="flex flex-1 flex-col gap-2 overflow-y-auto" style={{ maxHeight: "55vh" }}>
            {floorMsgs.map((m) => (
              <FloorItem
                key={m.seq}
                m={m}
                names={names}
                isHidden={hidden.has(m.seq)}
                score={scoreBySeq.get(m.seq)?.status === "done" ? scoreBySeq.get(m.seq)?.total ?? null : undefined}
                showScores={!!snap.scores}
              />
            ))}
            <div ref={floorEndRef} />
          </ul>
          <p className="mt-2 text-sm text-gray-600">{floorHint}</p>
          <div className="mt-2 flex flex-col gap-2">
            <textarea
              value={floorInput}
              onChange={(e) => {
                const v = e.target.value.slice(0, SPEECH_MAX_LEN);
                floorInputRef.current = v;
                setFloorInput(v);
                if (v.trim()) void claim();
              }}
              onFocus={() => { if (canWriteFloor) void claim(true); }}
              disabled={!canWriteFloor || sending}
              rows={3}
              placeholder={canWriteFloor ? "우리 팀의 생각을 써요" : "우리 팀 차례에 쓸 수 있어요"}
              className="rounded-xl border-2 border-gray-200 px-3 py-2 outline-none focus:border-blue-500 disabled:bg-gray-100"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{floorInput.length}/{SPEECH_MAX_LEN}</span>
              <button
                onClick={speak}
                disabled={!canWriteFloor || !floorInput.trim() || sending}
                className="rounded-xl bg-green-600 px-5 py-2 font-bold text-white disabled:bg-gray-300"
              >
                토론방에 말하기
              </button>
            </div>
          </div>
        </section>

        {/* 우리 팀 채팅 (V-R8, V-R28, V-R29) */}
        <section className={`kid-card flex min-h-[50vh] flex-col p-3 ${tab === "team" ? "" : "hidden md:flex"}`}>
          <h2 className="mb-2 font-bold">💬 우리 팀 채팅 · {myTeam}</h2>
          <p className="mb-2 text-xs text-gray-500">
            팀원: {teammates.map((t) => `${t.name}${t.online ? "" : "(접속 안 함)"}`).join(", ")}
          </p>
          <ul className="flex flex-1 flex-col gap-2 overflow-y-auto" style={{ maxHeight: "55vh" }}>
            {teamMsgs.map((m) => (
              <li
                key={m.seq}
                className={`rounded-xl border px-3 py-2 ${m.kind === "teacher_warning" ? "border-red-300 bg-red-50" : "bg-white"}`}
              >
                <p className="text-xs text-gray-500">
                  {m.kind === "teacher_warning" ? "👩‍🏫 선생님" : m.author}
                  {m.kind === "draft" ? " · (못 보낸 발언)" : ""}
                </p>
                <p className={m.kind === "teacher_warning" ? "font-bold text-red-800" : ""}>{m.content}</p>
                {(m.kind === "chat" || m.kind === "draft") && m.content && (
                  <button
                    onClick={() => promote(m.content ?? "")}
                    disabled={!canWriteFloor}
                    className="mt-1 min-h-0 rounded-lg border px-2 py-1 text-xs disabled:opacity-40"
                    style={{ minHeight: 0 }}
                  >
                    ⬆️ 토론방에 올리기
                  </button>
                )}
              </li>
            ))}
            <div ref={chatEndRef} />
          </ul>
          <div className="mt-2 flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value.slice(0, CHAT_MAX_LEN))}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void sendChat(); }}
              disabled={!chatOpen}
              placeholder={chatOpen ? "팀원에게 작전을 말해요" : "지금은 읽기만 할 수 있어요"}
              className="flex-1 rounded-xl border-2 border-gray-200 px-3 py-2 outline-none focus:border-blue-500 disabled:bg-gray-100"
            />
            <button
              onClick={sendChat}
              disabled={!chatOpen || !chatInput.trim()}
              className="rounded-xl bg-blue-600 px-4 font-bold text-white disabled:bg-gray-300"
            >
              보내기
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function FloorItem({
  m, names, isHidden, score, showScores,
}: {
  m: PollMessage;
  names: Record<Side, string>;
  isHidden: boolean;
  score: number | null | undefined;
  showScores: boolean;
}) {
  if (m.kind === "speech" && m.side) {
    return (
      <li className={`rounded-xl border-2 px-3 py-2 ${SIDE_STYLE[m.side].bubble}`}>
        <p className="flex items-center gap-2 text-xs text-gray-600">
          <span className={`rounded-full px-2 py-0.5 ${SIDE_STYLE[m.side].chip}`}>{names[m.side]}</span>
          {m.author}
          {showScores && (
            <span className="ml-auto rounded-full bg-white px-2 py-0.5 font-bold">
              {score === undefined ? "채점 중" : `${score}점`}
            </span>
          )}
        </p>
        <p className="mt-1">{isHidden || m.content === null ? <em className="text-gray-500">선생님이 가린 발언이에요</em> : m.content}</p>
      </li>
    );
  }
  if (m.kind === "announcement") {
    return <li className="rounded-xl bg-amber-50 px-3 py-2 text-sm">📌 선생님: {m.content}</li>;
  }
  return <li className="text-center text-sm text-gray-500">— {m.content} —</li>;
}
