import "server-only";
import { admin } from "@/lib/supabase/admin";

export interface DashboardStudent {
  student_id: string;
  display_name: string;
  participation_id: string | null;
  stance: "pro" | "con" | null;
  message_count: number;
  last_activity_at: string | null;
  off_topic_count: number;
  inappropriate_count: number;
  unacked_count: number;
  score_status: "pending" | "done" | "failed" | "skipped" | null;
  score_total: number | null;
}

export interface DashboardAlert {
  flag_id: string;
  display_name: string;
  reason: string | null;
  created_at: string;
  excerpt: string;
  participation_id: string;
}

export interface DashboardSnapshot {
  session: {
    id: string;
    class_id: string;
    class_name: string;
    teacher_id: string;
    topic: string;
    description: string | null;
    grade_level: number;
    status: "draft" | "open" | "closed";
    message_limit: number;
    opened_at: string | null;
    closed_at: string | null;
  } | null;
  students: DashboardStudent[];
  alerts: DashboardAlert[];
  summary: {
    totalStudents: number;
    joinedStudents: number;
    proCount: number;
    conCount: number;
    totalMessages: number;
    offTopicTotal: number;
    inappropriateTotal: number;
    scoredCount: number;
    averageTotal: number | null;
  };
}

/** 대시보드 전체를 DB 왕복 1회로 가져온다 (R29) */
export async function dashboardSnapshot(sessionId: string): Promise<DashboardSnapshot | null> {
  const { data, error } = await admin().rpc("dashboard_snapshot", { p_session_id: sessionId });
  if (error) throw new Error(`대시보드 조회 실패: ${error.message}`);
  const snap = data as DashboardSnapshot | null;
  if (!snap?.session) return null;
  return snap;
}
