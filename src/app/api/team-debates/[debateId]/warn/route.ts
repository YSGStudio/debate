import { NextResponse } from "next/server";
import { z } from "zod";
import { appendTeacherMessage, getOwnedTeamDebate } from "@/lib/db/team-debates";
import { NOTICE_MAX_LEN } from "@/lib/team/rules";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";

/** 한 팀의 채팅에 선생님 경고 (ver2 V-R18) */
export async function POST(req: Request, ctx: { params: Promise<{ debateId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();
  if (owned.debate.status !== "open") return jsonError("진행 중인 토론에만 보낼 수 있어요.", 409);

  const parsed = z
    .object({ side: z.enum(["pro", "con"]), content: z.string().trim().min(1).max(NOTICE_MAX_LEN) })
    .safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError(`경고는 1~${NOTICE_MAX_LEN}자입니다.`, 400);

  const msg = await appendTeacherMessage(owned.debate, "teacher_warning", parsed.data.side, parsed.data.content);
  return NextResponse.json({ message: msg });
}
