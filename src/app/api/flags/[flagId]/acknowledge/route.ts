import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedSession } from "@/lib/db/sessions";
import { acknowledgeFlag } from "@/lib/db/flags";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";

/** 경고 확인 처리 (R32). 상단 고정 영역에서만 사라지고 기록은 남는다. */
export async function POST(req: Request, ctx: { params: Promise<{ flagId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { flagId } = await ctx.params;

  const parsed = z.object({ sessionId: z.string().uuid() }).safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError("잘못된 요청입니다.", 400);

  const owned = await getOwnedSession(auth.teacherId, parsed.data.sessionId);
  if (!owned) return notFound();

  const ok = await acknowledgeFlag(flagId, parsed.data.sessionId);
  if (!ok) return notFound();
  return NextResponse.json({ ok: true });
}
