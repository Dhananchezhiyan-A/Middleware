import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: {
    default: "Lead Middleware",
    template: "%s · Lead Middleware",
  },
  description:
    "Lead Integration & Distribution Middleware — lead processing and delivery platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark-first theme: the class is applied at render time, so no theme flash.
    <html lang="en" className="dark" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
