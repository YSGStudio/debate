import "server-only";
import { getSession, listOpenSessions } from "./sessions";
import { getParticipation, listMessages } from "./participations";
import { getScore } from "./scores";
import { listFlags } from "./flags";
import type { CoachKind, SessionRow } from "./types";

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
  /**
   * 길잡이가 마지막 학생 메시지에 대해 남긴 안내.
   * 클라이언트가 messageId 로 이미 본 것인지 판단한다.
   */
  coach: { messageId: string; kind: CoachKind; message: string } | null;
  /** 입력이 잠겼는지와 그 이유 */
  locked: boolean;
  lockReason: "closed" | "limit" | null;
  score: {
    status: "pending" | "done" | "failed" | "skipped";
    total: number | null;
    baseTotal: number | null;
    offTopicPenalty: number | null;
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
      coach: null,
      locked: false,
      lockReason: null,
      score: null,
    };
  }

  const participation = await getParticipation(session.id, studentId);
  const messages = participation ? await listMessages(participation.id) : [];
  const scoreRow = participation ? await getScore(participation.id) : null;

  // 가장 최근 학생 메시지에 달린 길잡이 안내를 찾는다.
  // 판정은 뒤에서 도므로 아직 없을 수 있다. 그때는 다음 폴링에서 잡힌다.
  let coach: StudentDebateState["coach"] = null;
  if (participation) {
    const lastStudentMessage = [...messages].reverse().find((m) => m.role === "student");
    if (lastStudentMessage) {
      const flags = await listFlags(participation.id);
      const flag = flags.find((f) => f.message_id === lastStudentMessage.id);
      if (flag?.coach_kind && flag.coach_kind !== "none" && flag.coach_message) {
        coach = {
          messageId: lastStudentMessage.id,
          kind: flag.coach_kind,
          message: flag.coach_message,
        };
      }
    }
  }

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
    coach,
    locked: closed || atLimit,
    lockReason: closed ? "closed" : atLimit ? "limit" : null,
    score: scoreRow
      ? {
          status: scoreRow.status,
          total: scoreRow.total,
          baseTotal: scoreRow.base_total,
          offTopicPenalty: scoreRow.off_topic_penalty,
          scores:
            scoreRow.status === "done"
              ? {
                  claim: scoreRow.score_claim ?? 0,
                  evidence: scoreRow.score_evidence ?? 0,
                  counter: scoreRow.score_counter ?? 0,
                  development: scoreRow.score_development ?? 0,
                  participation: scoreRow.score_participation ?? 0,
                }
              : null,
          reasons: scoreRow.reasons,
          strengths: scoreRow.strengths,
          nextStep: scoreRow.next_step,
        }
      : null,
  };
}
