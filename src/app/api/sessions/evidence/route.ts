import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedClass } from "@/lib/db/classes";
import { researchEvidence } from "@/lib/ai/evidence";
import { EvidenceListSchema } from "@/lib/evidence";
import { isErr, jsonError, notFound, readJson, requireTeacher } from "@/lib/api";

// 입장마다 웹 검색 + 정리 + 주소 확인. 보통 10~15초 걸린다.
export const maxDuration = 60;

const Body = z.object({
  classId: z.string().uuid(),
  topic: z.string().trim().min(1, "토론 주제를 먼저 입력해 주세요.").max(100),
  description: z.string().max(300).optional().nullable(),
  proClaim: z.string().trim().min(1, "찬성 주장을 먼저 입력해 주세요.").max(100),
  conClaim: z.string().trim().min(1, "반대 주장을 먼저 입력해 주세요.").max(100),
  sides: z.array(z.enum(["pro", "con"])).min(1).max(2).optional(),
  /** "더 찾기" 일 때 이미 가진 자료. 같은 자료를 다시 가져오지 않는다. */
  existing: EvidenceListSchema.optional(),
});

/**
 * 찬성·반대 근거 자료 조사. **저장하지 않는다.**
 * 교사가 화면에서 읽고 지운 뒤 `POST /api/sessions` 나 `PATCH {action:"evidence"}` 로 저장한다.
 */
export async function POST(req: Request) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;

  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "입력을 확인해 주세요.", 400);

  // 학년별 말투로 정리하려고 학급을 본다. 남의 학급이면 404 (R4).
  const cls = await getOwnedClass(auth.teacherId, parsed.data.classId);
  if (!cls) return notFound();

  try {
    const items = await researchEvidence({
      topic: parsed.data.topic,
      description: parsed.data.description?.trim() || null,
      proClaim: parsed.data.proClaim,
      conClaim: parsed.data.conClaim,
      grade: cls.grade_level,
      sides: parsed.data.sides,
      existing: parsed.data.existing,
    });
    return NextResponse.json({ items });
  } catch (e) {
    console.error("[evidence] 근거 자료 조사 실패:", e instanceof Error ? e.message : e);
    return jsonError("자료를 찾지 못했습니다. 잠시 뒤 다시 시도해 주세요.", 502);
  }
}
