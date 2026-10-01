import { z } from "zod";

/**
 * 개인 토론을 만들 때 미리 조사해 두는 근거 자료 한 건.
 *
 * 토론 중에 실시간으로 검색하면 응답이 길어지고(학년 분량 규칙 붕괴) 느려지며 비용이 몇 배가 된다.
 * 그래서 주제를 정할 때 한 번 조사해 저장하고, 토론 AI는 이 목록 안에서만 인용한다.
 * `url` 은 교사 확인용이다. 토론 프롬프트와 학생 화면에는 넘기지 않는다.
 */
export const EvidenceItemSchema = z.object({
  side: z.enum(["pro", "con"]),
  /** 누가 말했는지. 예: "세계보건기구", "한국교육개발원" */
  source: z.string().trim().min(1).max(100),
  /** 초등학생이 알아듣는 한 문장 */
  finding: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(500),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/** 한쪽 입장당 모으는 자료 수 (찬반 합쳐 5~10개가 되도록) */
export const EVIDENCE_PER_SIDE = { min: 3, max: 5 } as const;

/** 세션 하나에 저장할 수 있는 최대 개수. 교사가 요청을 조작해도 프롬프트가 무한정 커지지 않게 한다. */
export const EVIDENCE_MAX = 12;

export const EvidenceListSchema = z.array(EvidenceItemSchema).max(EVIDENCE_MAX);

/** 검색 도구가 붙이는 추적 파라미터와 끝 슬래시를 떼고 비교한다 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

/**
 * 모델이 정리한 항목을 걸러 저장할 모양으로 만든다.
 *
 * - **실제로 인용된 주소(`citedUrls`)의 자료만** 남긴다. 모델이 주소를 지어내도 여기서 걸러진다.
 * - 이미 가진 주소(`excludeUrls`, "더 찾기" 때)와 같은 주소는 다시 넣지 않는다.
 * - 형식이 틀린 항목은 버리고, 한쪽 최대 개수에서 자른다.
 */
export function selectEvidence(
  raw: unknown[],
  side: EvidenceItem["side"],
  citedUrls: string[],
  excludeUrls: string[] = [],
): EvidenceItem[] {
  const allowed = new Set(citedUrls.map(normalizeUrl));
  const seen = new Set(excludeUrls.map(normalizeUrl));
  const out: EvidenceItem[] = [];
  for (const r of raw) {
    const parsed = EvidenceItemSchema.safeParse({ ...(r as object), side });
    if (!parsed.success) continue;
    const url = normalizeUrl(parsed.data.url);
    if (!allowed.has(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ ...parsed.data, url });
    if (out.length >= EVIDENCE_PER_SIDE.max) break;
  }
  return out;
}
