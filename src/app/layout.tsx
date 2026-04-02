import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agora x ScaleDown",
  description: "Voice AI agent with context compression",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen">{children}</body>
    </html>
  );
}
