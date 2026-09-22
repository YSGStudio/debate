"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { POLL_INTERVAL_MS, type Side, type TeamPhase } from "./rules";

/** team_poll 응답 (0006_team_debate.sql) */
export interface PollMessage {
  id: string;
  seq: number;
  channel: "floor" | Side;
  kind: "speech" | "pass" | "system" | "announcement" | "chat" | "draft" | "teacher_warning";
  phase: TeamPhase;
  side: Side | null;
  memberId: string | null;
  author: string | null;
  /** 학생에게는 가린 발언의 내용이 null 로 온다 */
  content: string | null;
  hidden: boolean;
  createdAt: string;
}

export interface PollScore {
  seq: number;
  status: "pending" | "done" | "failed" | "skipped";
  total: number | null;
  // 교사에게만
  scoreId?: string;
  logic?: number | null;
  evidence?: number | null;
  response?: number | null;
  phaseFit?: number | null;
  attitude?: number | null;
  reason?: string | null;
  respondedToSeq?: number | null;
  edited?: boolean;
}

export type FloorState = "closed" | "team_only" | "paused" | "open" | "time_up" | "final_done";

export interface PollSnapshot {
  serverNow: string;
  debate: {
    id: string; topic: string; description: string | null; gradeLevel: number;
    status: "draft" | "open" | "closed"; phase: TeamPhase; proName: string; conName: string;
    turnSeconds: number; stageSeconds: Record<string, number>; scoreVisibility: "live" | "after_end";
    speakerBalance: boolean; paused: boolean; phaseRemainingMs: number | null; resultsPublished: boolean;
    classId: string;
  };
  floorState: FloorState;
  turn: {
    id: string; side: Side; idx: number; remainingMs: number; elapsedMs: number;
    lockMemberId: string | null; lockName: string | null;
  } | null;
  finalSpeeches: Record<Side, number>;
  announcement: { seq: number; content: string; createdAt: string } | null;
  messages: PollMessage[];
  hiddenSeqs: number[];
  scores: PollScore[] | null;
  totals: {
    pro: number; con: number; byStage: Partial<Record<TeamPhase, Record<Side, number>>>;
    pendingCount: number; failedCount: number;
  } | null;
  members: { id: string; name: string; side: Side; speechCount: number; online: boolean }[];
  me: { memberId: string; side: Side; speechCount: number; name: string } | null;
  alerts: {
    id: string; kind: "inappropriate" | "duplicate_login" | "consecutive_pass"; side: Side | null;
    detail: string | null; createdAt: string; name: string | null; excerpt: string | null;
    channel: string | null; seq: number | null;
  }[] | null;
  penalties: { side: Side; phase: TeamPhase; points: number; reason: string }[] | null;
  report: { status: string; winner: string | null; error: string | null } | null;
  maxSeq: number;
  /** 클라이언트가 응답을 받은 시각 (Date.now). 남은 시간 보간에 쓴다. */
  receivedAt: number;
}

export interface PollError {
  status: number;
  code?: string;
  message?: string;
}

/**
 * 팀 토론 폴링 (V-R49). 1.5초 간격, 받은 번호 이후 메시지만 받아 합친다.
 * `onSnapshot` 은 새 응답마다 불린다 (못 보낸 발언 저장 같은 반응을 effect 없이 처리하려고).
 */
export function useTeamPoll(
  url: string | null,
  onSnapshot?: (snap: PollSnapshot, prev: PollSnapshot | null) => void,
) {
  const [snap, setSnap] = useState<PollSnapshot | null>(null);
  const [messages, setMessages] = useState<PollMessage[]>([]);
  const [error, setError] = useState<PollError | null>(null);
  const sinceRef = useRef(0);
  const inflight = useRef(false);
  const prevRef = useRef<PollSnapshot | null>(null);
  const cbRef = useRef(onSnapshot);
  useEffect(() => {
    cbRef.current = onSnapshot;
  }, [onSnapshot]);

  const poll = useCallback(async () => {
    if (!url || inflight.current) return;
    inflight.current = true;
    try {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${sep}since=${sinceRef.current}`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        setError({ status: res.status, code: body.code, message: body.error });
        return;
      }
      const body = (await res.json()) as Omit<PollSnapshot, "receivedAt">;
      const next: PollSnapshot = { ...body, receivedAt: Date.now() };
      if (body.messages.length > 0) {
        sinceRef.current = Math.max(sinceRef.current, ...body.messages.map((m) => m.seq));
        setMessages((cur) => {
          const seen = new Set(cur.map((m) => m.seq));
          return [...cur, ...body.messages.filter((m) => !seen.has(m.seq))].sort((a, b) => a.seq - b.seq);
        });
      }
      setError(null);
      setSnap(next);
      cbRef.current?.(next, prevRef.current);
      prevRef.current = next;
    } catch {
      // 네트워크가 잠깐 끊겨도 다음 폴링이 잇는다
    } finally {
      inflight.current = false;
    }
  }, [url]);

  const reset = useCallback(() => {
    sinceRef.current = 0;
    prevRef.current = null;
    setMessages([]);
    setError(null);
  }, []);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    const tick = () => { if (alive) void poll(); };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); };
  }, [url, poll]);

  return { snap, messages, error, refresh: poll, reset };
}

/** 250ms 마다 바뀌는 현재 시각. 남은 시간 막대를 부드럽게 그린다. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * 서버가 준 남은 시간에서 받은 뒤 흐른 시간만 뺀다 (V-R19).
 * 판정은 서버가 하고, 클라이언트는 그림만 그린다. 일시정지 중이면 줄이지 않는다.
 */
export function remainingMs(serverRemaining: number | null | undefined, snap: PollSnapshot, now: number): number | null {
  if (serverRemaining === null || serverRemaining === undefined) return null;
  if (snap.debate.paused) return serverRemaining;
  return Math.max(0, serverRemaining - (now - snap.receivedAt));
}

export function mmss(ms: number | null): string {
  if (ms === null) return "--:--";
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
