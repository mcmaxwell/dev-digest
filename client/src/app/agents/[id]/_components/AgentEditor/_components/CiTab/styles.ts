import type { CSSProperties } from "react";

/** Co-located styles for CiTab. */
export const s = {
  wrap: { maxWidth: 720 } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700, marginBottom: 6 } satisfies CSSProperties,
  sub: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 18,
    lineHeight: 1.55,
  } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 18,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  explainer: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
    marginBottom: 14,
  } satisfies CSSProperties,
  points: {
    listStyle: "none",
    padding: 0,
    margin: "0 0 18px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  point: {
    display: "flex",
    gap: 9,
    alignItems: "flex-start",
    fontSize: 12.5,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  pointIcon: { marginTop: 2, flexShrink: 0, color: "var(--text-faint, var(--text-muted))" } satisfies CSSProperties,
  activeIn: { fontSize: 13, fontWeight: 600, marginBottom: 12 } satisfies CSSProperties,
  repos: {
    listStyle: "none",
    padding: 0,
    margin: "0 0 18px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  repo: {
    display: "flex",
    gap: 9,
    alignItems: "center",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  repoName: { fontWeight: 600, color: "var(--text-primary, inherit)" } satisfies CSSProperties,
  repoDate: { color: "var(--text-muted)" } satisfies CSSProperties,
  gateCard: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 18,
    marginTop: 14,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  saving: { fontSize: 12, color: "var(--text-muted)", marginTop: 6 } satisfies CSSProperties,
};
