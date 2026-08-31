/* Per-agent colour identity for the multi-agent screens.

   It lives on the shared `multi-agent/_components/` ancestor rather than inside
   either feature because BOTH the configure screen and the results screen paint
   it, and `pnpm lint` forbids one feature importing a sibling feature's
   `_components/`.

   Presentational only: nothing about an agent's colour is persisted, sent over a
   contract, or derived from its id. A hash of the id would look unstable and
   would collide; the index is stable because both screens list agents in the
   same order - agent name ascending, then agent-run id, which is the order the
   server itself established for a run's columns
   (`server/src/modules/reviews/multi-agent.ts:52`). So the same agent keeps its
   colour across reloads, and across both screens whenever the two lists hold
   the same agents.

   Colour is never the ONLY carrier of anything: every agent name, severity and
   stance is also printed as text (the accessibility requirement of both L07
   specs). Turning colour off loses nothing but the glanceability. */

/**
 * The palette, in assignment order. Eight hues, so five agents in one run are
 * distinguishable at a glance; a ninth agent reuses the first hue rather than
 * inventing a colour nobody chose.
 */
export const AGENT_COLORS = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#a855f7", // purple
  "#14b8a6", // teal
  "#ec4899", // pink
  "#22c55e", // green
  "#6366f1", // indigo
] as const;

/** The colour of the agent at `index` in a screen's stable agent order. */
export function agentColor(index: number): string {
  return AGENT_COLORS[((index % AGENT_COLORS.length) + AGENT_COLORS.length) % AGENT_COLORS.length]!;
}
