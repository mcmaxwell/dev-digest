import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView (mirrors the SkillsView page shell). */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repoName: { color: "var(--accent)" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  scanMeta: { fontSize: 13, color: "var(--text-muted)", marginTop: 6 } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
  } satisfies CSSProperties,
  counter: { flex: 1, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  groups: { display: "flex", flexDirection: "column", gap: 26 } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  groupHead: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  groupCount: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  banner: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 18,
  } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
