import type { CSSProperties } from "react";

/** Co-located styles for the Smart Diff view. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  groupSwatch: {
    width: 9,
    height: 9,
    borderRadius: 2,
    flexShrink: 0,
  } satisfies CSSProperties,
  groupLabel: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  groupDesc: {
    fontSize: 12,
    color: "var(--text-muted)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  groupCount: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  files: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  status: {
    padding: "18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,

  // ---- split suggestion ----
  banner: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 7,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  bannerTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  bannerBody: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  bannerList: {
    margin: "8px 0 0",
    paddingLeft: 18,
    fontSize: 12,
    color: "var(--text-primary)",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,
  bannerSplitFiles: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
