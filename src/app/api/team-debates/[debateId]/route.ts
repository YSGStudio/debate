import { NextResponse } from "next/server";
import { z } from "zod";
import {
  archiveTeamDebate,
  deleteTeamDebate,
  getOwnedTeamDebate,
  getTeamDebate,
  listTeamMembers,
  openTeamDebateAtomic,
  publishTeamResults,
  restoreTeamDebate,
  teamControl,
  teamDebateDeletionImpact,
  updateDraftTeamDebate,
} from "@/lib/db/team-debates";
import { listStudents } from "@/lib/db/students";
import { runInBackground } from "@/lib/background";
import { buildTeamReport } from "@/lib/team-scoring-service";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";
import { GRADE_LEVELS } from "@/lib/grade-presets";
import { TeamDebateSettings, stageSecondsFrom } from "@/lib/team/teacher-input";

// "토론 종료" 뒤 결과 생성이 after() 로 돈다: 채점 대기 최대 60초 + 피드백 호출
export const maxDuration = 300;

type Ctx = { params: Promise<{ debateId: string }> };

/** 설정·배정 화면용 */
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();

  const [members, students] = await Promise.all([
    listTeamMembers(debateId),
    listStudents(owned.debate.class_id, true),
  ]);
  return NextResponse.json({
    debate: owned.debate,
    className: owned.className,
    members: members.map((m) => ({ id: m.id, studentId: m.student_id, side: m.side, name: m.display_name })),
    students: students.map((s) => ({ id: s.id, name: s.display_name })),
  });
}

const Patch = TeamDebateSettings.partial().extend({
  action: z.enum([
    "update", "open", "start", "next", "pause", "resume", "extend", "end", "publish", "archive", "restore",
  ]),
  gradeLevel: z
    .number()
    .int()
    .refine((v) => (GRADE_LEVELS as readonly number[]).includes(v), "학년은 3~6만 가능합니다.")
    .optional(),
});

const CONTROL_FAIL: Record<string, string> = {
  start: "대기 중인 토론만 시작할 수 있어요.",
  next: "다음 단계로 갈 수 없어요.",
  pause: "지금은 멈출 수 없어요.",
  resume: "멈춘 토론이 아니에요.",
  extend: "지금은 연장할 수 없어요.",
  end: "진행 중인 토론이 아니에요.",
};

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();
  const debate = owned.debate;

  const parsed = Patch.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "입력을 확인해 주세요.", 400);
  const b = parsed.data;

  switch (b.action) {
    case "update": {
      // draft 에서만 (V-R2)
      if (debate.status !== "draft") return jsonError("이미 연 토론은 설정을 바꿀 수 없어요.", 409);
      const updated = await updateDraftTeamDebate(debateId, {
        topic: b.topic,
        description: b.description === undefined ? undefined : b.description || null,
        proName: b.proName,
        conName: b.conName,
        stageSeconds: b.stageMinutes ? stageSecondsFrom(b.stageMinutes, debate.stage_seconds) : undefined,
        turnSeconds: b.turnSeconds,
        scoreVisibility: b.scoreVisibility,
        speakerBalance: b.speakerBalance,
        gradeLevel: b.gradeLevel,
      });
      if (!updated) return jsonError("이미 연 토론은 설정을 바꿀 수 없어요.", 409);
      return NextResponse.json({ debate: updated });
    }

    case "open": {
      if (debate.status !== "draft") return jsonError("이미 연 토론이에요.", 409);
      // 1:1 과 합쳐 "한 번에 하나만" 검사와 전이를 DB 트랜잭션 안에서 한다 (V-R4)
      const r = await openTeamDebateAtomic(debateId);
      if (r.result === "conflict") {
        return jsonError(
          `이미 열려 있는 토론이 있습니다: "${r.conflictTopic}". 먼저 종료하거나 토론 설정에서 "한 번에 하나만 열기"를 꺼주세요.`,
          409,
          { openTopic: r.conflictTopic },
        );
      }
      if (r.result !== "opened") return jsonError("입장을 열지 못했어요.", 409);
      return NextResponse.json({ debate: await getTeamDebate(debateId) });
    }

    case "publish": {
      if (!(await publishTeamResults(debateId))) return jsonError("끝난 토론만 결과를 공개할 수 있어요.", 409);
      return NextResponse.json({ published: true });
    }

    case "archive": {
      if (debate.status === "open") return jsonError("진행 중인 토론입니다. 먼저 종료해 주세요.", 409);
      if (!(await archiveTeamDebate(debateId))) return jsonError("보관하지 못했습니다.", 409);
      return NextResponse.json({ archived: true });
    }

    case "restore": {
      if (!(await restoreTeamDebate(debateId))) return jsonError("되돌리지 못했습니다.", 409);
      return NextResponse.json({ restored: true });
    }

    default: {
      const r = await teamControl(debateId, b.action);
      if (r === "not_found") return notFound();
      if (r !== "ok") return jsonError(CONTROL_FAIL[b.action] ?? "처리하지 못했어요.", 409);
      // 결과 생성은 뒤에서 한다. 종료 응답이 기다리지 않는다 (V-R38).
      if (b.action === "end") runInBackground(buildTeamReport(debateId), "team/결과 생성");
      return NextResponse.json({ debate: await getTeamDebate(debateId) });
    }
  }
}

/**
 * 완전 삭제. `?preview=1` 이면 지우지 않고 사라질 것만 돌려준다 (V-R5).
 * 보관된 것만, 진행 중이 아닌 것만 지운다.
 */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();

  const impact = await teamDebateDeletionImpact(owned.debate);
  const shaped = {
    ...impact,
    messageCount: impact.speechCount + impact.chatCount,
    openTopics: owned.debate.status === "open" ? [owned.debate.topic] : [],
  };
  if (new URL(req.url).searchParams.get("preview") === "1") return NextResponse.json({ impact: shaped });

  if (owned.debate.status === "open") return jsonError("진행 중인 토론입니다. 먼저 종료해 주세요.", 409);
  if (!owned.debate.archived_at) return jsonError("먼저 보관함으로 옮겨 주세요.", 409, { needsArchive: true });

  if (!(await deleteTeamDebate(debateId))) return jsonError("토론을 지우지 못했습니다.", 500);
  return NextResponse.json({ deleted: true, impact: shaped });
}
