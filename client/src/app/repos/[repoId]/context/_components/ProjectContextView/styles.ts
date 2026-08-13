import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
  } satisfies CSSProperties,
  panes: (narrow: boolean) =>
    ({
      display: "grid",
      gridTemplateColumns: narrow ? "1fr" : "320px 1fr",
      gap: 0,
      flex: 1,
      minHeight: 0,
    }) satisfies CSSProperties,

  // ---- tree ----
  tree: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderRight: "1px solid var(--border)",
  } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  toolbarTitle: {
    fontSize: 13,
    fontWeight: 650,
    color: "var(--text-primary)",
    flex: 1,
  } satisfies CSSProperties,
  list: { flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 0" } satisfies CSSProperties,
  row: (selected: boolean) =>
    ({
      display: "flex",
      alignItems: "baseline",
      gap: 6,
      width: "100%",
      padding: "5px 14px",
      border: "none",
      textAlign: "left",
      cursor: "pointer",
      fontSize: 12.5,
      background: selected ? "var(--accent-bg)" : "transparent",
      color: selected ? "var(--accent-text)" : "var(--text-secondary)",
    }) satisfies CSSProperties,
  rowDir: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  rowFile: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  footer: {
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 11.5,
    color: "var(--text-muted)",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,

  // ---- viewer ----
  viewer: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
  } satisfies CSSProperties,
  viewerHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 18px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  viewerPath: {
    fontSize: 12.5,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  viewerSpacer: { flex: 1 } satisfies CSSProperties,
  viewerBody: { flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 22px" } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 18px",
    fontSize: 12.5,
    background: "var(--warn-bg)",
    color: "var(--warn)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
};
