import { NextResponse } from "next/server";
import { z } from "zod";
import { createClass, listClasses } from "@/lib/db/classes";
import { isErr, jsonError, readJson, requireTeacher } from "@/lib/api";
import { GRADE_LEVELS } from "@/lib/grade-presets";

const Body = z.object({
  name: z.string().min(1, "학급 이름을 입력해 주세요.").max(40),
  gradeLevel: z
    .number()
    .int()
    .refine((v) => (GRADE_LEVELS as readonly number[]).includes(v), "학년은 3~6만 가능합니다."),
});

export async function GET() {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;
  return NextResponse.json({ classes: await listClasses(auth.teacherId) });
}

/** 학급 생성 (R5, R40) */
export async function POST(req: Request) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;

  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "입력을 확인해 주세요.", 400);

  const cls = await createClass(auth.teacherId, parsed.data.name, parsed.data.gradeLevel);
  return NextResponse.json({ class: cls });
}
