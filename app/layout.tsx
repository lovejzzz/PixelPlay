import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pixel Play",
  description: "AI pixel-art studio — assets, edits, sprite sheets, and scenes from a prompt.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="farm-bg min-h-screen">{children}</body>
    </html>
  );
}
