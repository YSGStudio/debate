import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6 py-16">
      <div>
        <h1 className="text-3xl font-bold">토론 친구</h1>
        <p className="mt-2 text-gray-600">
          내 생각을 말하면, 반대편에서 되물어주는 토론 상대예요.
        </p>
      </div>

      <Link
        href="/join"
        className="rounded-2xl bg-blue-600 px-6 py-6 text-center text-xl font-bold text-white active:bg-blue-700"
      >
        학생으로 들어가기
      </Link>

      <div className="text-center text-sm text-gray-500">
        <Link href="/teacher/login" className="underline">
          선생님이신가요? 로그인
        </Link>
      </div>
    </main>
  );
}
