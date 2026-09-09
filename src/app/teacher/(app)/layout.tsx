import { redirect } from "next/navigation";
import Link from "next/link";
import { getTeacherSession } from "@/lib/session/teacher";
import { getTeacher } from "@/lib/db/teachers";
import LogoutButton from "./logout-button";

/** 교사 화면 접근 보호 (R3). 미인증이면 로그인으로 보낸다. */
export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const session = await getTeacherSession();
  if (!session) redirect("/teacher/login");

  const teacher = await getTeacher(session.teacherId);
  if (!teacher) redirect("/teacher/login");

  return (
    <div className="min-h-dvh">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <Link href="/teacher" className="font-bold">토론 친구 · 선생님</Link>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <Link href="/teacher/archive" className="hover:underline">보관함</Link>
            <span>{teacher.name} 선생님</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-5 py-6">{children}</div>
    </div>
  );
}
