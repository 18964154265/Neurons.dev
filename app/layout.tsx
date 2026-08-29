import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Neurons",
  description: "Build real web applications with an AI engineering team.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
