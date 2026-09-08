import { NextResponse } from "next/server";
import { clearTeacherSession } from "@/lib/session/teacher";

export async function POST() {
  await clearTeacherSession();
  return NextResponse.json({ ok: true });
}
