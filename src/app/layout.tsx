import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "luo",
  description: "AI image and video generation workspace."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
