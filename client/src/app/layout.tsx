import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { themeNoFlashScript } from "@/lib/theme";
import { AppShellSkeleton } from "@/components/app-shell";

// Self-hosted by Next (downloaded at build time, served from our own origin —
// no runtime Google Fonts request). styles.css still names the family
// "Inter" for the body font-family fallback chain, but this generated class
// (applied below) is what actually supplies the font: it wins on specificity
// regardless, so anyone without Inter installed locally still gets Inter.
const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "DevDigest",
  description: "Local-first AI PR review tool",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} data-theme="dark" data-density="regular" suppressHydrationWarning>
      <head>
        {/* set theme before paint to avoid FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
      </head>
      {/* suppressHydrationWarning: browser extensions (Grammarly, translators, …)
          inject attributes like data-gr-ext-installed onto <body> before React
          hydrates. This suppresses ONLY this element's own attribute mismatch
          (one level deep) — real mismatches in descendants are still reported. */}
      <body className={inter.className} suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* Every route is a whole-page "use client" component that reads
              useSearchParams, so Next requires a Suspense boundary above it —
              this is that boundary. Its fallback renders in place of (not
              nested inside) Providers while suspended, so it must be static
              chrome only; the previous `fallback={null}` sent completely
              blank HTML for every route's first paint. */}
          <Suspense fallback={<AppShellSkeleton />}>
            <Providers>{children}</Providers>
          </Suspense>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
