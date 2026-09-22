import { z } from "zod";
import {
  DEFAULT_STAGE_SECONDS,
  STAGE_MINUTES_MAX,
  STAGE_MINUTES_MIN,
  STAGE_PHASES,
  TURN_SECONDS_DEFAULT,
  TURN_SECONDS_MAX,
  TURN_SECONDS_MIN,
  type StagePhase,
} from "./rules";

/** 팀 토론 설정 입력 (ver2 V-R1). 생성과 draft 수정이 같이 쓴다. */
export const TeamDebateSettings = z.object({
  topic: z.string().trim().min(1, "주제를 적어주세요.").max(100, "주제는 100자 이내입니다."),
  description: z.string().trim().max(300, "보충 설명은 300자 이내입니다.").nullable().optional(),
  proName: z.string().trim().min(1).max(20, "팀 이름은 20자 이내입니다.").optional(),
  conName: z.string().trim().min(1).max(20, "팀 이름은 20자 이내입니다.").optional(),
  /** 단계별 분 (1~20) */
  stageMinutes: z
    .object(
      Object.fromEntries(
        STAGE_PHASES.map((p) => [p, z.number().min(STAGE_MINUTES_MIN).max(STAGE_MINUTES_MAX)]),
      ) as Record<StagePhase, z.ZodNumber>,
    )
    .partial()
    .optional(),
  turnSeconds: z.number().int().min(TURN_SECONDS_MIN).max(TURN_SECONDS_MAX).optional(),
  scoreVisibility: z.enum(["live", "after_end"]).optional(),
  speakerBalance: z.boolean().optional(),
});
export type TeamDebateSettingsInput = z.infer<typeof TeamDebateSettings>;

export function stageSecondsFrom(
  minutes: TeamDebateSettingsInput["stageMinutes"],
  base: Record<StagePhase, number> = DEFAULT_STAGE_SECONDS,
): Record<StagePhase, number> {
  const out = { ...base };
  for (const p of STAGE_PHASES) {
    const m = minutes?.[p];
    if (m !== undefined) out[p] = Math.round(m * 60);
  }
  return out;
}

export const DEFAULT_TURN_SECONDS = TURN_SECONDS_DEFAULT;
