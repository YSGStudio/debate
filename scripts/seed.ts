/**
 * 시드 데이터 (Pre-Work P4).
 *   npm run db:seed
 *
 * 초대 코드 1개, 데모 교사 1명, 학급 1개, 학생 5명을 만든다.
 * 이미 있으면 건너뛴다.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const INVITE_CODE = "TEACHER2026";
const DEMO_EMAIL = "demo-teacher@example.com";
const DEMO_PASSWORD = "demo-teacher-1234";
const NAMES = ["김하늘", "이바다", "박구름", "최나무", "정별빛"];

async function main() {
  // 초대 코드
  await db.from("invite_codes").upsert(
    { code: INVITE_CODE, note: "시드 초대 코드", max_uses: 20, is_active: true },
    { onConflict: "code" },
  );
  console.log(`초대 코드: ${INVITE_CODE} (최대 20명)`);

  // 데모 교사
  const { data: created, error } = await db.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });

  let teacherId = created?.user?.id;
  if (error) {
    const { data: list } = await db.auth.admin.listUsers();
    teacherId = list?.users.find((u) => u.email === DEMO_EMAIL)?.id;
    if (!teacherId) { console.error("데모 교사를 만들지 못했습니다:", error.message); process.exit(1); }
    console.log("데모 교사가 이미 있습니다.");
  }

  await db.from("teachers").upsert({ id: teacherId!, email: DEMO_EMAIL, name: "데모" }, { onConflict: "id" });

  // 학급
  const { data: existing } = await db
    .from("classes").select("id, join_code").eq("teacher_id", teacherId!).limit(1).maybeSingle();

  let classId = (existing as { id: string; join_code: string } | null)?.id;
  let joinCode = (existing as { id: string; join_code: string } | null)?.join_code;

  if (!classId) {
    const { data: cls, error: ce } = await db
      .from("classes")
      .insert({ teacher_id: teacherId!, name: "4학년 2반", grade_level: 4, join_code: "204020" })
      .select("id, join_code").single();
    if (ce) { console.error("학급 생성 실패:", ce.message); process.exit(1); }
    classId = (cls as { id: string }).id;
    joinCode = (cls as { join_code: string }).join_code;
  }

  await db.from("students").upsert(
    NAMES.map((n) => ({ class_id: classId!, display_name: n })),
    { onConflict: "class_id,display_name" },
  );

  console.log("");
  console.log("시드 완료");
  console.log(`  교사 로그인: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  학급 코드:   ${joinCode}`);
  console.log(`  학생:        ${NAMES.join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
