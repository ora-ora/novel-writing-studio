import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "纸间 · 小说创作工作台",
  description: "编辑大纲，逐章创作小说正文。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
