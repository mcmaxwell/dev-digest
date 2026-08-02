/* AppShellSkeleton — static approximation of AppFrame's chrome (sidebar rail +
   topbar, sized to match) with no data/provider dependency. Used ONLY as the
   root layout's <Suspense> fallback (layout.tsx): every route is a whole-page
   "use client" component that reads useSearchParams, so Next.js requires a
   Suspense boundary somewhere above it — but that boundary previously sat at
   the very root with `fallback={null}`, so the server-rendered HTML for every
   route was completely blank until hydration. AppShell itself can't be reused
   here: it needs ShellContext (theme, active repo, Link) from Providers, and
   Suspense fallbacks render in place of — not nested inside — the tree that
   suspended, so Providers isn't mounted yet either. This renders only what
   needs no data: the sidebar's logo mark and matching dimensions, so the
   real AppShell can mount over it without a layout jump.

   DELIBERATELY imports NOTHING — not even `@devdigest/ui`. This is a server
   component reached from the ROOT layout, so anything it imports is evaluated
   during SSR for every route; pulling the UI barrel dragged in recharts, which
   is not RSC-safe and made every page 500 with "Super expression must either be
   null or a function". Keep the markup inline. */
import React from "react";

/** Inline stand-in for `<Skeleton>`; see the no-imports note above. */
function Block({ height, width }: { height: number; width?: number }) {
  return (
    <div
      style={{
        height,
        width: width ?? "100%",
        borderRadius: 6,
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
      }}
    />
  );
}

export function AppShellSkeleton() {
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", minHeight: "100vh", background: "var(--bg-primary)" }}>
      <aside
        style={{
          width: 264,
          flexShrink: 0,
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border)",
          padding: "24px 14px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 5px 14px" }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "var(--text-primary)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            {/* lucide `layers`, inlined — matches AppShell's logo mark. */}
            <svg
              width={15}
              height={15}
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--bg-primary)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
              <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
              <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
            </svg>
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>DevDigest</span>
        </div>
      </aside>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            height: 52,
            flexShrink: 0,
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-primary)",
          }}
        />
        <main style={{ flex: 1, minHeight: 0, padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto", width: "100%" }}>
          <Block height={28} width={320} />
          <Block height={16} width={220} />
          <Block height={160} />
        </main>
      </div>
    </div>
  );
}
