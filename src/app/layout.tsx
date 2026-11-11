import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "snap2spotify",
  description: "Turn screenshots of music recommendations into Spotify playlists.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-bg text-fg">{children}</body>
    </html>
  );
}
