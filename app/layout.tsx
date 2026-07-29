import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "MFU Admission Assistant",
  description:
    "Answers questions about international admission to Mae Fah Luang University from the official 2026 Admission Guides.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-stone-100 text-stone-900 antialiased">{children}</body>
    </html>
  );
}
