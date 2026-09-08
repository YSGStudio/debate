import "server-only";
import { admin } from "@/lib/supabase/admin";
import { UNIQUE_VIOLATION, type ScoreRow } from "./types";

const COLS =
  "id, participation_id, status, score_evidence, score_listening, score_development, score_expression, total, reasons, strengths, next_step, model, attempts, error";

/**
 * 채점 착수권을 가져온다 (R57).
 * unique 제약 위반 = 이미 다른 경로가 채점을 시작함 -> false.
 * 애플리케이션 플래그가 아니라 DB 제약으로 막는다.
 */
export async function claimScoring(participationId: string): Promise<boolean> {
  const { error } = await admin()
    .from("debate_scores")
    .insert({ participation_id: participationId, status: "pending", attempts: 1 });
  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  throw new Error(`채점 착수 실패: ${error.message}`);
}

/** 교사의 재채점 요청 (R52). failed 상태에서만 다시 pending 으로 돌린다. */
export async function reclaimForRetry(participationId: string): Promise<boolean> {
  const { data: cur } = await admin()
    .from("debate_scores")
    .select("attempts")
    .eq("participation_id", participationId)
    .eq("status", "failed")
    .maybeSingle();
  if (!cur) return false;
  const { data } = await admin()
    .from("debate_scores")
    .update({
      status: "pending",
      error: null,
      attempts: ((cur as { attempts: number }).attempts ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("participation_id", participationId)
    .eq("status", "failed")
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

export async function setSkipped(participationId: string): Promise<void> {
  await admin()
    .from("debate_scores")
    .update({ status: "skipped", updated_at: new Date().toISOString() })
    .eq("participation_id", participationId);
}

export async function setFailed(participationId: string, message: string): Promise<void> {
  await admin()
    .from("debate_scores")
    .update({ status: "failed", error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("participation_id", participationId);
}

export interface ScorePayload {
  evidence: number;
  listening: number;
  development: number;
  expression: number;
  total: number;
  reasons: Record<string, string>;
  strengths: string[];
  nextStep: string;
  model: string;
}

export async function setDone(participationId: string, p: ScorePayload): Promise<void> {
  const { error } = await admin()
    .from("debate_scores")
    .update({
      status: "done",
      score_evidence: p.evidence,
      score_listening: p.listening,
      score_development: p.development,
      score_expression: p.expression,
      total: p.total,
      reasons: p.reasons,
      strengths: p.strengths,
      next_step: p.nextStep,
      model: p.model,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("participation_id", participationId);
  if (error) throw new Error(`채점 결과 저장 실패: ${error.message}`);
}

export async function getScore(participationId: string): Promise<ScoreRow | null> {
  const { data } = await admin()
    .from("debate_scores")
    .select(COLS)
    .eq("participation_id", participationId)
    .maybeSingle();
  return (data as ScoreRow) ?? null;
}
