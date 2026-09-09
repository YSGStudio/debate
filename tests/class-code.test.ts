import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  generateClassCode,
  isValidClassCode,
  normalizeClassCode,
} from "@/lib/class-code";
import { invalidNames, parseRoster } from "@/lib/roster";

describe("학급 코드 (R5)", () => {
  it("숫자만 쓴다 — 초등학생이 칠판을 보고 옮겨 적기 쉬워야 한다", () => {
    expect(CODE_ALPHABET).toBe("0123456789");
  });

  it("숫자 6자리를 만든다", () => {
    for (let i = 0; i < 500; i++) {
      const c = generateClassCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect(c).toMatch(/^[0-9]{6}$/);
      expect(isValidClassCode(c)).toBe(true);
    }
  });

  it("모든 자릿수가 실제로 쓰인다 (0 이나 9 가 빠지지 않는다)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const ch of generateClassCode()) seen.add(ch);
    expect(seen.size).toBe(10);
  });

  it("공백과 하이픈을 걷어낸다", () => {
    expect(normalizeClassCode(" 123 456 ")).toBe("123456");
    expect(normalizeClassCode("123-456")).toBe("123456");
  });

  it("잘못된 코드를 거른다", () => {
    expect(isValidClassCode("12345")).toBe(false);   // 5자리
    expect(isValidClassCode("1234567")).toBe(false); // 7자리
    expect(isValidClassCode("ABC234")).toBe(false);  // 알파벳
    expect(isValidClassCode("12A456")).toBe(false);
    expect(isValidClassCode("")).toBe(false);
  });
});

describe("명단 파싱 (R6)", () => {
  it("줄바꿈과 쉼표로 나눈다", () => {
    expect(parseRoster("김하늘\n이바다, 박구름\n\n").names).toEqual(["김하늘", "이바다", "박구름"]);
  });

  it("붙여넣은 명단 안의 중복을 찾아낸다 (AC3)", () => {
    const r = parseRoster("김하늘\n이바다\n김하늘");
    expect(r.duplicates).toEqual(["김하늘"]);
  });

  it("중복이 없으면 빈 배열이다", () => {
    expect(parseRoster("김하늘\n이바다").duplicates).toEqual([]);
  });

  it("너무 긴 이름을 걸러낸다", () => {
    expect(invalidNames(["김하늘", "가".repeat(21)])).toHaveLength(1);
  });
});
