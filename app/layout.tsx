import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenKanban",
  description: "A kanban board where dependencies are part of the data model.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
