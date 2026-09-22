import "server-only";
import { cookies } from "next/headers";

/**
 * 팀 토론 기기 식별 쿠키 (ver2 V-R9).
 *
 * 학생 인증(`ss_token`)은 그대로 두고, "지금 이 학생으로 쓰고 있는 브라우저" 만 구분한다.
 * 같은 학생이 다른 기기로 들어오면 team_members.device_id 가 바뀌고
 * 앞 기기의 요청은 409 replaced 를 받는다.
 */
export const DEVICE_COOKIE = "td_device";
const MAX_AGE = 12 * 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getDeviceId(): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(DEVICE_COOKIE)?.value ?? null;
  return v && UUID.test(v) ? v : null;
}

/** 없으면 새로 만든다. 입장(`/api/team/enter`)에서만 부른다. */
export async function ensureDeviceId(): Promise<string> {
  const existing = await getDeviceId();
  if (existing) return existing;
  const id = crypto.randomUUID();
  const jar = await cookies();
  jar.set(DEVICE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return id;
}
