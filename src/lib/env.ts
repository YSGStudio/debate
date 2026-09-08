/** 서버 전용 환경 변수 접근. 빌드 시점에 던지지 않도록 지연 평가한다. */

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`환경 변수 ${name} 가 설정되지 않았습니다. .env.local 을 확인하세요.`);
  return v;
}

export const env = {
  get supabaseUrl() { return req("NEXT_PUBLIC_SUPABASE_URL"); },
  get supabaseAnonKey() { return req("NEXT_PUBLIC_SUPABASE_ANON_KEY"); },
  get supabaseServiceRoleKey() { return req("SUPABASE_SERVICE_ROLE_KEY"); },
  get openaiApiKey() { return req("OPENAI_API_KEY"); },
  get debateModel() { return process.env.OPENAI_DEBATE_MODEL || "gpt-4.1"; },
  get triageModel() { return process.env.OPENAI_TRIAGE_MODEL || "gpt-4.1-mini"; },
  get scoringModel() { return process.env.OPENAI_SCORING_MODEL || "gpt-4.1"; },
  get studentSessionSecret() { return req("STUDENT_SESSION_SECRET"); },
  get teacherSessionSecret() { return req("TEACHER_SESSION_SECRET"); },
};

/** 설정이 빠졌을 때 사용자에게 보여줄 안내용. 던지지 않는다. */
export function missingEnvKeys(): string[] {
  return [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPENAI_API_KEY",
    "STUDENT_SESSION_SECRET",
    "TEACHER_SESSION_SECRET",
  ].filter((k) => !process.env[k]);
}
