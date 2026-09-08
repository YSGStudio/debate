import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 백그라운드 작업 전달 (R27, R45).
 * after() 가 실패하는 이유를 구분하지 않으면, 배포 환경에서 판정·채점이
 * 조용히 유실되고 아무 흔적도 남지 않는다.
 */

const afterMock = vi.fn();

vi.mock("next/server", () => ({
  after: (p: Promise<unknown>) => afterMock(p),
}));

const { runInBackground } = await import("@/lib/background");

beforeEach(() => {
  afterMock.mockReset();
  vi.restoreAllMocks();
});

describe("runInBackground", () => {
  it("요청 스코프 안에서는 after() 에 등록한다", async () => {
    afterMock.mockImplementation(() => {});
    const done = Promise.resolve("ok");
    runInBackground(done, "테스트");

    expect(afterMock).toHaveBeenCalledTimes(1);
    await done;
  });

  it("작업이 실패해도 호출부로 예외를 던지지 않는다", async () => {
    afterMock.mockImplementation(() => {});
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => runInBackground(Promise.reject(new Error("작업 실패")), "테스트")).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    expect(spy.mock.calls.flat().join(" ")).toContain("작업 실패");
  });

  it("요청 스코프 밖(테스트·스크립트)에서는 조용히 흘려보낸다", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => runInBackground(Promise.resolve("ok"), "테스트")).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    // 정상적인 경우이므로 경고를 남기지 않는다
    expect(spy).not.toHaveBeenCalled();
  });

  it("그 밖의 after() 실패는 작업 유실 가능성으로 로그를 남긴다", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("`waitUntil` is not available in the current environment.");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => runInBackground(Promise.resolve("ok"), "채점")).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("채점");
    expect(logged).toContain("after() 등록 실패");
    expect(logged).toContain("waitUntil");
  });

  it("after() 가 실패해도 작업 자체는 계속 실행된다", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("`waitUntil` is not available in the current environment.");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    let ran = false;
    runInBackground(
      (async () => {
        ran = true;
      })(),
      "테스트",
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(ran).toBe(true);
  });
});
