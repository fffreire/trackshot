import type { Metadata } from "next";
import { PRODUCT } from "./brand";
import "./globals.css";

export const metadata: Metadata = {
  title: PRODUCT.name,
  description: "Screenshot any song or list. Get it in your playlist.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-bg text-fg">{children}</body>
    </html>
  );
}
