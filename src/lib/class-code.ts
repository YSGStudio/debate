import { randomInt } from "node:crypto";

/**
 * 학급 코드는 숫자 6자리다 (PRD R5).
 *
 * 초등학생이 칠판을 보고 그대로 옮겨 적어야 하므로 숫자만 쓴다.
 * 알파벳을 섞으면 대소문자·유사 글자 때문에 저학년이 자주 틀린다.
 */
export const CODE_ALPHABET = "0123456789";
export const CODE_LENGTH = 6;

export function generateClassCode(rand: (max: number) => number = (m) => randomInt(m)): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
  return out;
}

/** 공백·하이픈을 걷어낸다. 아이가 "123 456" 이나 "123-456" 으로 적어도 통하게 한다. */
export function normalizeClassCode(input: string): string {
  return input.trim().replace(/[\s-]/g, "");
}

export function isValidClassCode(input: string): boolean {
  const c = normalizeClassCode(input);
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch));
}
