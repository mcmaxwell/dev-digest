import type { Metadata } from "next";
import { HomeView } from "./_components/HomeView";

/* Route: / (home). Thin route entry — the view lives in _components/HomeView,
   following the same wrapper pattern as agents/page.tsx and onboarding. Being
   a server entry (no "use client") lets it export metadata. */
export const metadata: Metadata = {
  title: "DevDigest",
};

export default function HomePage() {
  return <HomeView />;
}
