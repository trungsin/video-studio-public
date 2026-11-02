import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Xưởng video", description: "Sản xuất & lịch đăng" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
