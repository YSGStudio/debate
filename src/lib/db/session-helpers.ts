import "server-only";
import { getSession, listOpenSessions } from "./sessions";
import { getParticipation, listMessages } from "./participations";
import { getScore } from "./scores";
import type { SessionRow } from "./types";

export interface StudentDebateState {
  /** 학생이 지금 들어갈 수 있는 열린 토론들 */
  openSessions: { id: string; topic: string; description: string | null }[];
  session: {
    id: string;
    topic: string;
    description: string | null;
    gradeLevel: number;
    status: SessionRow["status"];
    messageLimit: number;
  } | null;
  participation: { id: string; stance: "pro" | "con"; messageCount: number } | null;
  messages: { role: "student" | "bot"; content: string }[];
  /** 입력이 잠겼는지와 그 이유 */
  locked: boolean;
  lockReason: "closed" | "limit" | null;
  score: {
    status: "pending" | "done" | "failed" | "skipped";
    total: number | null;
    scores: Record<string, number> | null;
    reasons: Record<string, string> | null;
    strengths: string[] | null;
    nextStep: string | null;
  } | null;
}

/**
 * 학생 한 명의 현재 상태를 모은다.
 * 반 평균이나 다른 학생 정보는 절대 포함하지 않는다 (R53).
 */
export async function getOwnedClassless(
  classId: string,
  studentId: string,
  sessionId: string | null,
): Promise<StudentDebateState> {
  const open = await listOpenSessions(classId);
  const openSessions = open.map((s) => ({ id: s.id, topic: s.topic, description: s.description }));

  let session: SessionRow | null = null;
  if (sessionId) {
    const s = await getSession(sessionId);
    if (s && s.class_id === classId) session = s;
  } else if (open.length === 1) {
    session = open[0];
  }

  if (!session) {
    return {
      openSessions,
      session: null,
      participation: null,
      messages: [],
      locked: false,
      lockReason: null,
      score: null,
    };
  }

  const participation = await getParticipation(session.id, studentId);
  const messages = participation ? await listMessages(participation.id) : [];
  const scoreRow = participation ? await getScore(participation.id) : null;

  const atLimit = (participation?.student_message_count ?? 0) >= session.message_limit;
  const closed = session.status !== "open";

  return {
    openSessions,
    session: {
      id: session.id,
      topic: session.topic,
      description: session.description,
      gradeLevel: session.grade_level,
      status: session.status,
      messageLimit: session.message_limit,
    },
    participation: participation
      ? {
          id: participation.id,
          stance: participation.stance,
          messageCount: participation.student_message_count,
        }
      : null,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    locked: closed || atLimit,
    lockReason: closed ? "closed" : atLimit ? "limit" : null,
    score: scoreRow
      ? {
          status: scoreRow.status,
          total: scoreRow.total,
          scores:
            scoreRow.status === "done"
              ? {
                  evidence: scoreRow.score_evidence ?? 0,
                  listening: scoreRow.score_listening ?? 0,
                  development: scoreRow.score_development ?? 0,
                  expression: scoreRow.score_expression ?? 0,
                }
              : null,
          reasons: scoreRow.reasons,
          strengths: scoreRow.strengths,
          nextStep: scoreRow.next_step,
        }
      : null,
  };
}
