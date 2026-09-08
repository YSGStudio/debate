import { randomInt } from "node:crypto";

/** 혼동되는 글자(0 O 1 I L)를 뺀 알파벳 (PRD R5) */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

export function generateClassCode(rand: (max: number) => number = (m) => randomInt(m)): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
  return out;
}

export function normalizeClassCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s|-/g, "");
}

export function isValidClassCode(input: string): boolean {
  const c = normalizeClassCode(input);
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch));
}
