import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedClass } from "@/lib/db/classes";
import { createSession } from "@/lib/db/sessions";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";

const Body = z.object({
  classId: z.string().uuid(),
  topic: z.string().min(1, "토론 주제를 입력해 주세요.").max(100, "주제는 100자 이내로 써주세요."),
  description: z.string().max(300, "설명은 300자 이내로 써주세요.").optional().nullable(),
  messageLimit: z.number().int().min(3).max(100).default(30),
});

/** 세션 생성 (R9). 학급의 학년을 스냅샷으로 복사한다 (R41). */
export async function POST(req: Request) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;

  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "입력을 확인해 주세요.", 400);

  const cls = await getOwnedClass(auth.teacherId, parsed.data.classId);
  if (!cls) return notFound();

  const session = await createSession(
    cls.id,
    cls.grade_level,
    parsed.data.topic.trim(),
    parsed.data.description?.trim() || null,
    parsed.data.messageLimit,
  );
  return NextResponse.json({ session });
}
