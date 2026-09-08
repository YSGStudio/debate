import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let cached: SupabaseClient | null = null;

/**
 * service role 클라이언트. RLS 를 우회하므로 **서버에서만** 쓴다.
 * 모든 DB 접근은 이 클라이언트를 통한다 (PRD: RLS 전면 거부 + service role 우회).
 */
export function admin(): SupabaseClient {
  if (!cached) {
    cached = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** 익명 클라이언트. 교사 비밀번호 검증(signInWithPassword)에만 쓴다. */
export function anon(): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
