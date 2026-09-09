export type SessionStatus = "draft" | "open" | "closed";
export type Stance = "pro" | "con";
export type MessageRole = "student" | "bot";
export type TriageVerdict = "on_topic" | "off_topic" | "inappropriate";
export type ScoreStatus = "pending" | "done" | "failed" | "skipped";

export interface ClassRow {
  id: string;
  teacher_id: string;
  name: string;
  grade_level: number;
  join_code: string;
  single_active_session: boolean;
  created_at: string;
  archived_at: string | null;
}

export interface StudentRow {
  id: string;
  class_id: string;
  display_name: string;
  is_active: boolean;
}

export interface SessionRow {
  id: string;
  class_id: string;
  topic: string;
  description: string | null;
  grade_level: number;
  status: SessionStatus;
  message_limit: number;
  opened_at: string | null;
  closed_at: string | null;
  /** 보관함에 들어간 시각. null 이면 목록에 보인다. */
  archived_at: string | null;
  created_at: string;
}

export interface ParticipationRow {
  id: string;
  session_id: string;
  student_id: string;
  stance: Stance;
  student_message_count: number;
  last_activity_at: string | null;
}

export interface MessageRow {
  id: string;
  participation_id: string;
  seq: number;
  role: MessageRole;
  content: string;
  created_at: string;
}

export interface ScoreAnalysis {
  evidence: string;
  counter: string;
  shortAnswers: string;
  focus: string;
}

/** 5영역 100점 + 주제 이탈 감점 (0 ~ -15) */
export interface ScoreRow {
  id: string;
  participation_id: string;
  status: ScoreStatus;
  score_claim: number | null;
  score_evidence: number | null;
  score_counter: number | null;
  score_development: number | null;
  score_participation: number | null;
  off_topic_penalty: number | null;
  base_total: number | null;
  total: number | null;
  reasons: Record<string, string> | null;
  strengths: string[] | null;
  next_step: string | null;
  analysis: ScoreAnalysis | null;
  change_summary: string | null;
  change_reason: string | null;
  model: string | null;
  attempts: number;
  error: string | null;
}

export type CoachKind = "praise" | "need_reason" | "off_topic" | "none";

export interface FlagRow {
  id: string;
  message_id: string;
  participation_id: string;
  verdict: TriageVerdict;
  reason: string | null;
  triage_failed: boolean;
  acknowledged_at: string | null;
  /** 학생 화면에 실시간으로 띄우는 길잡이 안내 */
  coach_kind: CoachKind | null;
  coach_message: string | null;
  created_at: string;
}

/** Postgres unique_violation */
export const UNIQUE_VIOLATION = "23505";
