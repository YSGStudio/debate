import { NextResponse } from "next/server";
import { z } from "zod";
import { suggestStanceClaims } from "@/lib/ai/stance-claims";
import { isErr, jsonError, readJson, requireTeacher } from "@/lib/api";

export const maxDuration = 30;

const Body = z.object({
  topic: z.string().trim().min(1, "토론 주제를 먼저 입력해 주세요.").max(100, "주제는 100자 이내로 써주세요."),
  description: z.string().max(300).optional().nullable(),
});

/**
 * 찬성·반대 주장 초안. 저장하지 않는다.
 * 교사가 화면에서 확인·수정한 값을 `POST /api/sessions` 로 보낸다.
 */
export async function POST(req: Request) {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;

  const parsed = Body.safeParse(await readJson<unknown>(req));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "입력을 확인해 주세요.", 400);

  try {
    const claims = await suggestStanceClaims(parsed.data.topic, parsed.data.description?.trim() || null);
    return NextResponse.json(claims);
  } catch (e) {
    console.error("[claims] 주장 초안 생성 실패:", e instanceof Error ? e.message : e);
    return jsonError("초안을 만들지 못했습니다. 직접 입력해 주세요.", 502);
  }
}
