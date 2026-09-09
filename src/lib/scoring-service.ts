import "server-only";
import { getSession } from "@/lib/db/sessions";
import { getParticipationById, listMessages, listParticipations } from "@/lib/db/participations";
import { claimScoring, reclaimForRetry, setDone, setFailed, setSkipped } from "@/lib/db/scores";
import { countStudentMessages, MIN_STUDENT_MESSAGES, scoreDebate } from "@/lib/ai/scoring";

/**
 * 참여 1건 채점 (PRD R45~R52, R57).
 *
 * 착수권을 DB unique 제약으로 가져오므로, 세션 종료와 상한 도달이 동시에
 * 일어나도 모델 호출은 한 번만 일어난다.
 */
export async function runScoring(
  participationId: string,
  opts: { retry?: boolean } = {},
): Promise<"done" | "skipped" | "failed" | "already"> {
  const claimed = opts.retry
    ? await reclaimForRetry(participationId)
    : await claimScoring(participationId);
  if (!claimed) return "already";

  try {
    const participation = await getParticipationById(participationId);
    if (!participation) throw new Error("참여 정보를 찾을 수 없습니다.");

    const session = await getSession(participation.session_id);
    if (!session) throw new Error("세션 정보를 찾을 수 없습니다.");

    const messages = await listMessages(participationId);
    const transcript = messages.map((m) => ({ role: m.role, content: m.content }));

    // 대화가 너무 짧으면 채점하지 않는다. 모델을 부르지 않는다 (R51).
    if (countStudentMessages(transcript) < MIN_STUDENT_MESSAGES) {
      await setSkipped(participationId);
      return "skipped";
    }

    const result = await scoreDebate({
      topic: session.topic,
      studentStance: participation.stance,
      grade: session.grade_level,
      transcript,
    });

    await setDone(participationId, {
      claim: result.scores.claim,
      evidence: result.scores.evidence,
      counter: result.scores.counter,
      development: result.scores.development,
      participation: result.scores.participation,
      offTopicPenalty: result.offTopicPenalty,
      baseTotal: result.baseTotal,
      total: result.total,
      reasons: { ...result.reasons, offTopic: result.offTopicReason },
      strengths: result.strengths,
      nextStep: result.nextStep,
      analysis: result.analysis,
      changeSummary: result.changeSummary,
      changeReason: result.changeReason,
      model: result.model,
    });
    return "done";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[scoring] 채점 실패:", participationId, msg);
    await setFailed(participationId, msg);
    return "failed";
  }
}

/** 동시에 몇 명까지 채점할지. 30명 반에서 마지막 학생이 오래 기다리지 않게 한다. */
const CONCURRENCY = 4;

/** 세션 종료 시 전원 채점 (R45). 교사의 종료 응답을 막지 않도록 호출부에서 await 하지 않는다. */
export async function scoreWholeSession(sessionId: string): Promise<void> {
  const participations = await listParticipations(sessionId);
  const queue = [...participations];

  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await runScoring(next.id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
}
