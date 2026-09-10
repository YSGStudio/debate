import Link from "next/link";

export default function Home() {
  return (
    <main className="student-scope mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-5 py-12 text-center">
      <div className="mascot-bubble text-7xl" aria-hidden="true">🦉</div>
      <div className="kid-card px-6 py-8 sm:px-10">
        <span className="kid-badge">💬 생각이 쑥쑥 자라는 곳</span>
        <h1 className="mt-4 text-4xl font-bold text-blue-700">토론 친구</h1>
        <p className="mt-3 text-gray-600">
          내 생각을 이야기하고, 질문에 답하며<br className="hidden sm:block" /> 생각의 힘을 키워 봐요!
        </p>
      </div>

      <Link
        href="/join"
        className="rounded-2xl border-2 border-blue-800 bg-blue-600 px-6 py-5 text-center text-xl font-bold text-white active:bg-blue-700"
      >
        🚀 학생으로 시작하기
      </Link>

      <div className="text-center text-sm text-gray-500">
        <Link href="/teacher/login" className="underline">
          선생님이신가요? 선생님 로그인
        </Link>
      </div>
    </main>
  );
}
