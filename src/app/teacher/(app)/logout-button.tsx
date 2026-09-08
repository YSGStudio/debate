"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/teacher/logout", { method: "POST" });
        router.push("/teacher/login");
        router.refresh();
      }}
      className="rounded-lg border px-3 py-1 hover:bg-gray-50"
    >
      로그아웃
    </button>
  );
}
