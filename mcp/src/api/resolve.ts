import { slugFor, ambiguousSlugs } from '../format/slug.js';
import type { Agent, Repo } from './schemas.js';

/**
 * Semantic input (`owner/name`, an agent slug) to the uuids the API addresses
 * everything by. There is no `GET /repos/:owner/:name`, so `GET /repos` is
 * fetched and matched here.
 *
 * The sources are declared structurally rather than as `ApiClient` on purpose:
 * `src/api/index.ts` re-exports this module, and importing the port back from
 * the barrel would make the two files circular (`no-circular` in
 * .dependency-cruiser.cjs). Any object with these two methods will do.
 */
export interface ResolverSources {
  listRepos(): Promise<Repo[]>;
  listAgents(): Promise<Agent[]>;
}

export type RepoResolution =
  | { ok: true; repo: Repo }
  | { ok: false; reason: 'unknown'; known: string[] };

export type AgentResolution =
  | { ok: true; agent: Agent }
  | { ok: false; reason: 'unknown'; known: string[] }
  | { ok: false; reason: 'ambiguous'; slug: string; matches: Agent[] };

export interface Resolvers {
  repo(fullName: string): Promise<RepoResolution>;
  agent(ref: string): Promise<AgentResolution>;
  /** The raw agent list, cached the same way, for `list_agents`. */
  agents(force?: boolean): Promise<Agent[]>;
}

/** Long enough that a multi-tool turn costs one fetch, short enough that a repo
 *  imported mid-session shows up without restarting the MCP server. */
export const CACHE_TTL_MS = 60_000;

function memo<T>(load: () => Promise<T>, ttlMs: number, now: () => number) {
  let value: T | undefined;
  let at = 0;
  return async (force = false): Promise<T> => {
    if (!force && value !== undefined && now() - at < ttlMs) return value;
    value = await load();
    at = now();
    return value;
  };
}

/** Pure part of agent resolution, so the miss/ambiguity rules are testable. */
export function resolveAgentIn(agents: readonly Agent[], ref: string): AgentResolution {
  const needle = ref.trim();
  const byId = agents.find((a) => a.id === needle);
  if (byId) return { ok: true, agent: byId };

  const lower = needle.toLowerCase();
  const wanted = slugFor(needle);
  const ambiguous = ambiguousSlugs(agents);
  const bySlug = agents.filter((a) => slugFor(a.name) === wanted);
  if (bySlug.length === 1) return { ok: true, agent: bySlug[0]! };
  if (bySlug.length > 1) return { ok: false, reason: 'ambiguous', slug: wanted, matches: bySlug };

  const byName = agents.filter((a) => a.name.toLowerCase() === lower);
  if (byName.length === 1) return { ok: true, agent: byName[0]! };
  if (byName.length > 1) {
    return { ok: false, reason: 'ambiguous', slug: wanted, matches: byName };
  }

  return {
    ok: false,
    reason: 'unknown',
    known: agents.map((a) => (ambiguous.has(slugFor(a.name)) ? a.id : slugFor(a.name))),
  };
}

/** Pure part of repo resolution. Matching is case-insensitive because GitHub
 *  treats owner/name that way and the model will echo whatever casing it saw. */
export function resolveRepoIn(repos: readonly Repo[], fullName: string): RepoResolution {
  const needle = fullName.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  const hit = repos.find(
    (r) =>
      r.full_name.toLowerCase() === needle ||
      `${r.owner}/${r.name}`.toLowerCase() === needle,
  );
  if (hit) return { ok: true, repo: hit };
  return { ok: false, reason: 'unknown', known: repos.map((r) => r.full_name) };
}

export function createResolvers(
  api: ResolverSources,
  opts: { ttlMs?: number; now?: () => number } = {},
): Resolvers {
  const ttl = opts.ttlMs ?? CACHE_TTL_MS;
  const now = opts.now ?? Date.now;
  const repos = memo(() => api.listRepos(), ttl, now);
  const agents = memo(() => api.listAgents(), ttl, now);

  return {
    async repo(fullName) {
      // A miss is the one case worth paying a second round trip for: it is
      // exactly what a repo imported since the cache was filled looks like.
      const first = resolveRepoIn(await repos(), fullName);
      if (first.ok) return first;
      return resolveRepoIn(await repos(true), fullName);
    },
    async agent(ref) {
      const first = resolveAgentIn(await agents(), ref);
      if (first.ok || first.reason === 'ambiguous') return first;
      return resolveAgentIn(await agents(true), ref);
    },
    agents,
  };
}
