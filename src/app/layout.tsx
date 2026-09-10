import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "토론 친구 - 초등 토론 수업",
  description: "학생이 의견을 말하면 반대편에서 되묻는 토론 챗봇, 교사용 관찰 대시보드",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
