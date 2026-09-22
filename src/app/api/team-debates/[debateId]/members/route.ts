import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedTeamDebate, setTeamMembers } from "@/lib/db/team-debates";
import { assignmentWarnings } from "@/lib/team/assign";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";

const Body = z.object({
  members: z
    .array(z.object({ studentId: z.string().uuid(), side: z.enum(["pro", "con"]) }))
    .refine((m) => new Set(m.map((x) => x.studentId)).size === m.length, "같은 학생이 두 번 있어요."),
});

/**
 * 팀 배정 저장 (ver2 V-R3). draft 또는 입장 대기(open+waiting)에서만.
 * 인원이 맞지 않으면 경고를 돌려주되 저장은 한다.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ debateId: string }> }) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  const { debateId } = await ctx.params;

  const owned = await getOwnedTeamDebate(auth.teacherId, debateId);
  if (!owned) return notFound();

  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "입력을 확인해 주세요.", 400);

  const r = await setTeamMembers(debateId, parsed.data.members);
  if (r === "invalid") return jsonError("토론이 시작된 뒤에는 팀을 바꿀 수 없어요.", 409);
  if (r === "invalid_student") return jsonError("이 토론에 등록되지 않은 학생이 있어요.", 400);
  if (r !== "ok") return notFound();

  const pro = parsed.data.members.filter((m) => m.side === "pro").length;
  const con = parsed.data.members.length - pro;
  return NextResponse.json({ saved: true, warnings: assignmentWarnings(pro, con) });
}
