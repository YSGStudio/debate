import { NextResponse } from "next/server";
import { z } from "zod";
import {
  closeSession,
  deleteSession,
  getOwnedSession,
  getSession,
  openSessionAtomic,
  sessionDeletionImpact,
  updateDraftSession,
} from "@/lib/db/sessions";
import { scoreWholeSession } from "@/lib/scoring-service";
import { runInBackground } from "@/lib/background";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";
import { GRADE_LEVELS } from "@/lib/grade-presets";

const Body = z.object({
  action: z.enum(["open", "close", "update"]),
  topic: z.string().min(1).max(100).optional(),
  description: z.string().max(300).nullable().optional(),
  gradeLevel: z
    .number()
    .int()
    .refine((v) => (GRADE_LEVELS as readonly number[]).includes(v))
    .optional(),
  messageLimit: z.number().int().min(3).max(100).optional(),
});

/**
 * 토론 삭제. 참여·대화·판정·채점이 함께 사라진다.
 * `?preview=1` 이면 지우지 않고 무엇이 사라지는지만 돌려준다.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { sessionId } = await ctx.params;

  const owned = await getOwnedSession(auth.teacherId, sessionId);
  if (!owned) return notFound();

  const impact = await sessionDeletionImpact(owned.session);

  if (new URL(req.url).searchParams.get("preview") === "1") {
    return NextResponse.json({ impact });
  }

  // 진행 중인 토론은 지우지 않는다. 대화하던 학생 화면이 그대로 멈춘다.
  if (owned.session.status === "open") {
    return jsonError("진행 중인 토론입니다. 먼저 종료해 주세요.", 409);
  }

  const ok = await deleteSession(sessionId);
  if (!ok) return jsonError("토론을 지우지 못했습니다.", 500);
  return NextResponse.json({ deleted: true, impact });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { sessionId } = await ctx.params;

  const owned = await getOwnedSession(auth.teacherId, sessionId);
  if (!owned) return notFound();

  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError("입력을 확인해 주세요.", 400);

  if (parsed.data.action === "update") {
    if (owned.session.status !== "draft") {
      return jsonError("이미 시작한 토론은 내용을 바꿀 수 없습니다.", 409);
    }
    const patch: Record<string, unknown> = {};
    if (parsed.data.topic !== undefined) patch.topic = parsed.data.topic.trim();
    if (parsed.data.description !== undefined)
      patch.description = parsed.data.description?.trim() || null;
    if (parsed.data.gradeLevel !== undefined) patch.grade_level = parsed.data.gradeLevel;
    if (parsed.data.messageLimit !== undefined) patch.message_limit = parsed.data.messageLimit;

    const updated = await updateDraftSession(sessionId, patch);
    if (!updated) return jsonError("수정하지 못했습니다.", 409);
    return NextResponse.json({ session: updated });
  }

  if (parsed.data.action === "open") {
    if (owned.session.status === "closed") return jsonError("이미 끝난 토론입니다.", 409);
    if (owned.session.status === "open") return NextResponse.json({ session: owned.session });

    // "한 번에 하나만 열기" 검사와 상태 전이를 DB 트랜잭션 안에서 한 번에 처리한다 (R11).
    // 조회-후-갱신으로 하면 교사가 두 번 빠르게 누를 때 둘 다 통과할 수 있다.
    const opened = await openSessionAtomic(sessionId);
    if (opened.result === "conflict") {
      return jsonError(
        `이미 열려 있는 토론이 있습니다: "${opened.conflictTopic}". 먼저 종료하거나 학급 설정에서 "한 번에 하나만 열기"를 꺼주세요.`,
        409,
        { openTopic: opened.conflictTopic },
      );
    }
    if (opened.result !== "opened") return jsonError("토론을 시작하지 못했습니다.", 409);

    const session = await getSession(sessionId);
    return NextResponse.json({ session });
  }

  // close
  if (owned.session.status !== "open") return jsonError("열려 있는 토론이 아닙니다.", 409);
  const closed = await closeSession(sessionId);
  if (!closed) return jsonError("토론을 종료하지 못했습니다.", 409);

  // 채점은 뒤에서 진행한다. 교사의 종료 응답을 기다리게 하지 않는다 (R45).
  runInBackground(scoreWholeSession(sessionId), "sessions/세션 채점");

  return NextResponse.json({ session: closed });
}
