import type { CSSProperties } from "react";

/** Co-located styles for MultiAgentConfigureView. */
export const s = {
  wrap: { maxWidth: 880, margin: "0 auto", padding: "36px 28px 60px" } satisfies CSSProperties,
  title: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    marginTop: 8,
    maxWidth: 620,
    lineHeight: 1.55,
  } satisfies CSSProperties,
  step: { marginTop: 28 } satisfies CSSProperties,
  stepHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  } satisfies CSSProperties,
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    fontSize: 11.5,
    fontWeight: 700,
    background: "var(--bg-hover)",
    color: "var(--text-secondary)",
    flexShrink: 0,
  } satisfies CSSProperties,
  stepLabel: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  stepAction: { marginLeft: "auto", display: "flex", gap: 10 } satisfies CSSProperties,
  picker: { maxWidth: 520 } satisfies CSSProperties,
  placeholder: {
    border: "1px dashed var(--border-strong)",
    borderRadius: 10,
    padding: "44px 24px",
    textAlign: "center",
  } satisfies CSSProperties,
  placeholderTitle: { fontSize: 14.5, fontWeight: 700 } satisfies CSSProperties,
  placeholderBody: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginTop: 6,
    maxWidth: 380,
    marginInline: "auto",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  // A selected row is ringed in that AGENT's colour rather than in one shared
  // accent, so four selected rows are four identities and not one block.
  // The checkbox still carries "selected" on its own, so nothing depends on it.
  row: (selected: boolean, color: string): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 9,
    border: `1px solid ${selected ? color : "var(--border)"}`,
    background: "var(--bg-surface)",
  }),
  // The icon tile is the agent's colour swatch on this screen - the same colour
  // its column, its tab and its ring carry on the results screen.
  iconBox: (color: string): CSSProperties => ({
    width: 28,
    height: 28,
    borderRadius: 7,
    display: "grid",
    placeItems: "center",
    // 22% alpha over the surface: a tint, not a block of colour under an icon.
    background: `${color}38`,
    color,
    flexShrink: 0,
  }),
  rowMain: { minWidth: 0, flex: 1 } satisfies CSSProperties,
  name: { fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
  description: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginTop: 3,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  runBar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 28,
  } satisfies CSSProperties,
  estimate: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,
  reason: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 12.5, color: "var(--sev-critical, #ef4444)", marginTop: 10 } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-muted)", padding: "18px 2px" } satisfies CSSProperties,
} as const;
