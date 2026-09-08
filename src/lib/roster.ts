/** 학생 명단 붙여넣기 파싱 (PRD R6) */

export interface RosterParseResult {
  names: string[];
  duplicates: string[];
}

/** 줄바꿈/쉼표로 구분된 이름을 파싱하고, 입력 안에서 중복된 이름을 찾아낸다. */
export function parseRoster(raw: string): RosterParseResult {
  const names = raw
    .split(/[\n,]/)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length > 0);

  const seen = new Set<string>();
  const dupSet = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) dupSet.add(n);
    else seen.add(n);
  }
  return { names, duplicates: [...dupSet] };
}

export const MAX_NAME_LENGTH = 20;

export function invalidNames(names: string[]): string[] {
  return names.filter((n) => n.length > MAX_NAME_LENGTH);
}
