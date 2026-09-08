/**
 * 마이그레이션 적용. psql 로 DATABASE_URL 에 SQL 파일을 실행한다.
 *   npm run db:migrate        -- supabase/migrations 의 up 파일을 번호순으로 전부 적용
 *   npm run db:migrate -- down -- 0001 되돌리기 (데이터가 전부 사라진다)
 *
 * 모든 up 파일은 여러 번 돌려도 안전하다(멱등).
 * psql 이 없으면 각 파일을 Supabase SQL Editor 에 번호순으로 붙여넣어도 된다.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 이 없습니다. .env.local 에 Supabase 의 직접 연결 문자열을 넣어주세요.");
  console.error("(Supabase 대시보드 > Project Settings > Database > Connection string)");
  console.error("");
  console.error("psql 을 쓸 수 없다면 아래 파일들을 번호순으로 SQL Editor 에 붙여넣으세요:");
  for (const f of listMigrations(false)) console.error(`  supabase/migrations/${f}`);
  process.exit(1);
}

function listMigrations(down: boolean): string[] {
  const dir = path.join("supabase", "migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f.includes("_down.") === down)
    .sort();
}

const down = process.argv.includes("down");
const files = listMigrations(down);

if (files.length === 0) {
  console.error("적용할 마이그레이션 파일이 없습니다.");
  process.exit(1);
}

for (const file of files) {
  const full = path.join("supabase", "migrations", file);
  console.log(`${down ? "되돌리기" : "적용"}: ${full}`);
  const r = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", full], { stdio: "inherit" });
  if (r.error) {
    console.error("psql 을 실행하지 못했습니다:", r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`실패: ${full}`);
    process.exit(r.status ?? 1);
  }
}

console.log(`\n${files.length}개 파일 적용 완료`);
