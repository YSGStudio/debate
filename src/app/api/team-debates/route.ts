import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedClass } from "@/lib/db/classes";
import { createTeamDebate } from "@/lib/db/team-debates";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";
import { defaultScoreVisibility, TURN_SECONDS_DEFAULT } from "@/lib/team/rules";
import { TeamDebateSettings, stageSecondsFrom } from "@/lib/team/teacher-input";

const Body = TeamDebateSettings.extend({ classId: z.string().uuid() });

/** 팀 토론 만들기 (ver2 V-R1, V-R2). 학급 학년을 스냅샷한다. */
export async function POST(req: Request) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;

  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "입력을 확인해 주세요.", 400);
  const b = parsed.data;

  const cls = await getOwnedClass(auth.teacherId, b.classId);
  if (!cls || cls.archived_at) return notFound();

  const debate = await createTeamDebate(cls.id, cls.grade_level, {
    topic: b.topic,
    description: b.description || null,
    proName: b.proName || "찬성팀",
    conName: b.conName || "반대팀",
    stageSeconds: stageSecondsFrom(b.stageMinutes),
    turnSeconds: b.turnSeconds ?? TURN_SECONDS_DEFAULT,
    scoreVisibility: b.scoreVisibility ?? defaultScoreVisibility(cls.grade_level),
    speakerBalance: b.speakerBalance ?? false,
  });
  return NextResponse.json({ debate }, { status: 201 });
}
