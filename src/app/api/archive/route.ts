import { NextResponse } from "next/server";
import { listArchivedClasses } from "@/lib/db/classes";
import { listArchivedSessions } from "@/lib/db/sessions";
import { isErr, requireTeacher } from "@/lib/api";

/** 보관함 목록. 보관된 학급과, 학급은 살아 있는데 보관된 토론을 함께 돌려준다. */
export async function GET() {
  const auth = await requireTeacher();
  if (isErr(auth)) return auth.response;

  const [classes, sessions] = await Promise.all([
    listArchivedClasses(auth.teacherId),
    listArchivedSessions(auth.teacherId),
  ]);

  return NextResponse.json({ classes, sessions });
}
