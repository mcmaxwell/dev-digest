/**
 * Agent slugs are DERIVED HERE, in the MCP layer. The DB has no slug column and
 * `(workspace_id, name)` carries no unique constraint, so a slug is a
 * convenience for the model, never an identity: every tool that prints one also
 * prints the uuid, and `run_agent_on_pr` refuses an ambiguous slug rather than
 * guessing which of two agents to bill.
 */

/** Words that carry no information once you already know these are agents. */
const NOISE_SUFFIXES = new Set(['reviewer', 'reviewers', 'agent', 'agents']);

/** "Security Reviewer" -> "security"; "API Contract" -> "api-contract". */
export function slugFor(name: string): string {
  const parts = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Never strip the LAST remaining word: an agent literally called "Agent"
  // must still get a slug.
  while (parts.length > 1 && NOISE_SUFFIXES.has(parts[parts.length - 1]!)) parts.pop();
  return parts.join('-');
}

export interface Named {
  id: string;
  name: string;
}

/** Slugs that more than one agent would answer to. */
export function ambiguousSlugs(agents: readonly Named[]): Set<string> {
  const counts = new Map<string, number>();
  for (const a of agents) {
    const slug = slugFor(a.name);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([slug]) => slug));
}
