import type { CSSProperties } from "react";

export const s = {
  wrap: { fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" } satisfies CSSProperties,
  h1: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: "0 0 12px",
  } satisfies CSSProperties,
  h2: {
    fontSize: 16,
    fontWeight: 650,
    color: "var(--text-primary)",
    margin: "22px 0 8px",
  } satisfies CSSProperties,
  h3: {
    fontSize: 14,
    fontWeight: 650,
    color: "var(--text-primary)",
    margin: "18px 0 6px",
  } satisfies CSSProperties,
  p: { margin: "0 0 12px" } satisfies CSSProperties,
  list: { margin: "0 0 12px", paddingLeft: 22 } satisfies CSSProperties,
  li: { margin: "0 0 4px" } satisfies CSSProperties,
  quote: {
    margin: "0 0 12px",
    padding: "4px 0 4px 12px",
    borderLeft: "2px solid var(--border)",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  pre: {
    margin: "0 0 12px",
    padding: 12,
    borderRadius: 6,
    overflowX: "auto",
    fontSize: 12.5,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  code: {
    fontSize: "0.92em",
    padding: "1px 6px",
    borderRadius: 4,
    background: "var(--bg-hover)",
    color: "var(--accent-text)",
  } satisfies CSSProperties,
  link: { color: "var(--accent-text)", textDecoration: "underline" } satisfies CSSProperties,
};
