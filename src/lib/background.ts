import "server-only";
import { after } from "next/server";

/**
 * 응답을 막지 않으면서도 끝까지 실행되어야 하는 작업을 넘긴다 (R27, R45).
 *
 * `after()` 는 서버리스에서 응답 반환 뒤에도 작업을 살려두지만 요청 스코프 안에서만
 * 쓸 수 있다. 스코프 밖(단위 테스트, 스크립트)에서는 그대로 흘려보낸다.
 */
export function runInBackground(work: Promise<unknown>, label: string): void {
  const guarded = work.catch((e) => {
    console.error(`[${label}]`, e instanceof Error ? e.message : e);
  });
  try {
    after(guarded);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    // 요청 스코프 밖(단위 테스트, 스크립트)은 정상적인 경우다. 조용히 흘려보낸다.
    if (message.includes("outside a request scope")) {
      void guarded;
      return;
    }

    // 그 밖의 실패(예: 배포 환경에 waitUntil 이 없음)는 작업이 유실될 수 있다는 뜻이다.
    // 조용히 넘어가면 판정·채점이 사라진 것을 아무도 모른다.
    console.error(
      `[${label}] after() 등록 실패 — 이 작업은 응답 후 중단될 수 있습니다: ${message}`,
    );
    void guarded;
  }
}
