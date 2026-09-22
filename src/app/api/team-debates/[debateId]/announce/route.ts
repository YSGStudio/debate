import { NextResponse } from "next/server";
import { z } from "zod";
import { appendTeacherMessage, getOwnedTeamDebate } from "@/lib/db/team-debates";
import { NOTICE_MAX_LEN } from "@/lib/team/rules";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";

/** 전체 공지 (ver2 V-R16). 가장 최근 공지가 토론방 맨 위에 고정된다. */
export async function POST(req: Request, ctx: { params: Promise<{ debateId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();
  if (owned.debate.status !== "open") return jsonError("진행 중인 토론에만 공지할 수 있어요.", 409);

  const parsed = z.object({ content: z.string().trim().min(1).max(NOTICE_MAX_LEN) }).safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError(`공지는 1~${NOTICE_MAX_LEN}자입니다.`, 400);

  const msg = await appendTeacherMessage(owned.debate, "announcement", "floor", parsed.data.content);
  return NextResponse.json({ message: msg });
}
