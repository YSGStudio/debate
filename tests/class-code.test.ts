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
  it("혼동되는 글자를 쓰지 않는다", () => {
    for (const ch of "01OIL") expect(CODE_ALPHABET).not.toContain(ch);
  });

  it("6자리를 만든다", () => {
    for (let i = 0; i < 200; i++) {
      const c = generateClassCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect(isValidClassCode(c)).toBe(true);
    }
  });

  it("소문자와 공백을 정규화한다", () => {
    expect(normalizeClassCode(" abc 234 ")).toBe("ABC234");
    expect(normalizeClassCode("abc-234")).toBe("ABC234");
  });

  it("잘못된 코드를 거른다", () => {
    expect(isValidClassCode("ABC23")).toBe(false);
    expect(isValidClassCode("ABC2O4")).toBe(false); // O 는 알파벳에 없다
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
