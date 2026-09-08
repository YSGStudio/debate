import { beforeEach, describe, expect, it, vi } from "vitest";

/** 인메모리 rate_limits 대역. 조건부 update 로 동시 요청 하나만 통과시키는 동작을 흉내낸다. */
const table = new Map<string, string>();

vi.mock("@/lib/supabase/admin", () => {
  function from() {
    let filterKey = "";
    let filterLastAt: string | null = null;
    let updateValue: string | null = null;
    const api = {
      select: () => api,
      eq: (col: string, val: string) => {
        if (col === "key") filterKey = val;
        if (col === "last_at") filterLastAt = val;
        return api;
      },
      maybeSingle: async () =>
        table.has(filterKey) ? { data: { key: filterKey, last_at: table.get(filterKey) } } : { data: null },
      insert: async (row: { key: string; last_at: string }) => {
        if (table.has(row.key)) return { error: { code: "23505" } };
        table.set(row.key, row.last_at);
        return { error: null };
      },
      update: (patch: { last_at: string }) => {
        updateValue = patch.last_at;
        return api;
      },
      then: undefined,
    };
    // update 체인의 종단
    Object.defineProperty(api, "select", {
      value: () => {
        if (updateValue === null) return api;
        const current = table.get(filterKey);
        if (filterLastAt !== null && current !== filterLastAt) return Promise.resolve({ data: [] });
        table.set(filterKey, updateValue);
        return Promise.resolve({ data: [{ key: filterKey }] });
      },
      writable: true,
    });
    return api;
  }
  return { admin: () => ({ from }) };
});

const { takeMessageSlot, MIN_INTERVAL_MS } = await import("@/lib/db/rate-limit");

beforeEach(() => table.clear());

describe("전송 속도 제한 (R38, AC17)", () => {
  it("간격은 5초다", () => {
    expect(MIN_INTERVAL_MS).toBe(5000);
  });

  it("첫 전송은 통과한다", async () => {
    expect(await takeMessageSlot("p1", 1_000_000)).toBe(true);
  });

  it("1초 뒤 재전송은 거부된다 (AC17)", async () => {
    const t0 = 1_000_000;
    expect(await takeMessageSlot("p1", t0)).toBe(true);
    expect(await takeMessageSlot("p1", t0 + 1000)).toBe(false);
  });

  it("5초가 지나면 다시 통과한다", async () => {
    const t0 = 1_000_000;
    await takeMessageSlot("p1", t0);
    expect(await takeMessageSlot("p1", t0 + 5000)).toBe(true);
  });

  it("학생마다 따로 센다", async () => {
    const t0 = 1_000_000;
    expect(await takeMessageSlot("p1", t0)).toBe(true);
    expect(await takeMessageSlot("p2", t0)).toBe(true);
  });
});
