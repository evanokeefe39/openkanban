import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // no `title` here: the document title is live app state (`<board name> —
  // OpenKanban`, set by BoardRoot), and a static metadata title would be
  // re-applied by Next after hydration and clobber it
  description: "A kanban board where dependencies are part of the data model.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/*
        No font link: JetBrains Mono is self-hosted from `/fonts` via
        `app/fonts.css`. The app makes no network request at all, which is what
        makes the offline claim true and keeps the visual comparison against the
        reference independent of a CDN fetch.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
