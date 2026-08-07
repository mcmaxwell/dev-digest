import type { GitClient, GitHubClient, RepoRef, UnifiedDiff } from '@devdigest/shared';
import {
  LINKED_ISSUE_RE,
  MAX_ISSUE_CHARS,
  MAX_PR_BODY_CHARS,
  MAX_REFERENCES,
  MAX_REPO_FILE_CHARS,
  MAX_REPO_FILE_REFS,
  MAX_TOTAL_SOURCE_CHARS,
  REPO_PATH_RE,
  SPEC_FILE_CANDIDATES,
  URL_RE,
} from './constants.js';
import { buildFileMap } from './hunk-map.js';
import { makeSource, type ResolvedSource } from './types.js';

/**
 * Context resolution for the intent classifier.
 *
 * Two properties this file exists to guarantee:
 *
 *  1. **Every source is recorded, including the ones that failed.** A source we
 *     could not read is `unreachable`, not omitted — that distinction is what
 *     caps the confidence downstream and what the "Missing context" notice on
 *     the card is built from. Silently dropping a failed fetch is how a
 *     classifier ends up confidently describing an issue it never saw.
 *  2. **No arbitrary URL is ever dereferenced.** Only github.com URLs pointing at
 *     THIS repo are resolved, and only through the existing `GitHubClient` /
 *     `GitClient` ports. Everything else is recorded as `external_url` /
 *     `unreachable` and never fetched, so the feature adds no SSRF surface.
 */

export interface SourceInput {
  pull: { title: string; body: string | null };
  repo: RepoRef;
  diff: UnifiedDiff;
  /** null when no GitHub token is configured — issue lookups then go `unreachable`. */
  github: GitHubClient | null;
  git: GitClient;
}

export async function resolveSources(input: SourceInput): Promise<ResolvedSource[]> {
  const body = input.pull.body?.trim() ?? '';
  const out: ResolvedSource[] = [];

  out.push(makeSource('pr_title', 'title', 'ok', input.pull.title));
  out.push(
    body.length > 0
      ? makeSource('pr_body', 'body', 'ok', body.slice(0, MAX_PR_BODY_CHARS))
      : makeSource('pr_body', 'body', 'absent'),
  );

  // The file map comes third, ahead of everything fetched: it is the only source
  // that describes the change ITSELF, it is derived rather than fetched (so it
  // can never fail), and `fitBudget` spends the budget in this order — a PR with
  // a long body and three linked issues must not lose its file list.
  out.push(
    makeSource('file_map', `${input.diff.files.length} file(s)`, 'ok', buildFileMap(input.diff)),
  );

  out.push(await resolveLinkedIssue(input, body));
  out.push(...(await resolveGitHubUrls(input, body)));
  out.push(...(await resolveRepoFiles(input, body)));
  out.push(...externalUrls(body));

  return fitBudget(dedupe(out));
}

/**
 * The `closes #123` link.
 *
 * `OctokitGitHubClient.resolveLinkedIssue` cannot be reused: it swallows its own
 * error and returns `undefined`, so it cannot tell "this PR links nothing" from
 * "this PR links an issue we failed to fetch" — and that is exactly the
 * distinction this layer is built on. So we match and call `getIssue` ourselves.
 */
async function resolveLinkedIssue(input: SourceInput, body: string): Promise<ResolvedSource> {
  const match = body.match(LINKED_ISSUE_RE);
  const number = match?.[1];
  if (!number) return makeSource('linked_issue', 'none', 'absent');
  const ref = `#${number}`;
  if (!input.github) return makeSource('linked_issue', ref, 'unreachable');
  try {
    const issue = await input.github.getIssue(input.repo, Number(number));
    return makeSource('linked_issue', ref, 'ok', issueText(issue.title, issue.body));
  } catch {
    return makeSource('linked_issue', ref, 'unreachable');
  }
}

/**
 * github.com URLs in the body. Three shapes are understood — an issue, a pull
 * request, and a file at a ref — and only when they point at THIS repository.
 * A GitHub URL for someone else's repo is recorded `unreachable`: we hold a
 * token for this workspace, and following a link into an arbitrary repo with it
 * is a confused-deputy read we are not willing to make.
 */
async function resolveGitHubUrls(input: SourceInput, body: string): Promise<ResolvedSource[]> {
  const out: ResolvedSource[] = [];
  for (const raw of matchAll(body, URL_RE).slice(0, MAX_REFERENCES * 2)) {
    if (out.length >= MAX_REFERENCES) break;
    const url = parseUrl(raw);
    if (!url || !isGitHubHost(url.hostname)) continue;

    const parts = url.pathname.split('/').filter(Boolean);
    const [owner, name, kind, ...rest] = parts;
    const sameRepo =
      owner?.toLowerCase() === input.repo.owner.toLowerCase() &&
      name?.toLowerCase() === input.repo.name.toLowerCase();

    if (kind === 'issues' || kind === 'pull') {
      const n = Number(rest[0]);
      if (!Number.isInteger(n) || n <= 0) continue;
      const ref = `${owner}/${name}#${n}`;
      if (!sameRepo || !input.github) {
        out.push(makeSource('github_url', ref, 'unreachable'));
        continue;
      }
      try {
        const meta =
          kind === 'issues'
            ? await input.github.getIssue(input.repo, n)
            : await input.github.getPullRequest(input.repo, n);
        out.push(makeSource('github_url', ref, 'ok', issueText(meta.title, meta.body ?? null)));
      } catch {
        out.push(makeSource('github_url', ref, 'unreachable'));
      }
      continue;
    }

    if (kind === 'blob') {
      // /owner/name/blob/<ref>/<path…> — the ref is dropped; the clone is at the
      // PR head and reading an arbitrary ref would need a fetch we don't do here.
      const path = rest.slice(1).join('/');
      if (!path) continue;
      if (!sameRepo) {
        out.push(makeSource('github_url', path, 'unreachable'));
        continue;
      }
      const content = await readRepoFile(input, path);
      out.push(
        content
          ? makeSource('github_url', path, 'ok', content)
          : makeSource('github_url', path, 'unreachable'),
      );
    }
  }
  return out;
}

/**
 * Repo-relative spec/plan files: the ones the body names, plus the standing
 * candidates. A missing candidate is `absent` and costs nothing; a path the
 * AUTHOR named and we could not read is `unreachable`, because they expected it
 * to be there.
 */
async function resolveRepoFiles(input: SourceInput, body: string): Promise<ResolvedSource[]> {
  const out: ResolvedSource[] = [];
  const seen = new Set<string>();

  for (const path of matchAll(body, REPO_PATH_RE)) {
    if (out.length >= MAX_REPO_FILE_REFS) break;
    if (seen.has(path)) continue;
    seen.add(path);
    const content = await readRepoFile(input, path);
    out.push(
      content
        ? makeSource('repo_file', path, 'ok', content)
        : makeSource('repo_file', path, 'unreachable'),
    );
  }

  for (const path of SPEC_FILE_CANDIDATES) {
    if (seen.has(path)) continue;
    const content = await readRepoFile(input, path);
    // Standing candidates are only reported when they EXIST — listing five
    // `absent` files on every PR would drown the real gaps in the notice.
    if (content) {
      seen.add(path);
      out.push(makeSource('repo_file', path, 'ok', content));
    }
  }

  return out;
}

/**
 * Every non-GitHub http(s) URL, recorded and never fetched. `ref` is the HOST
 * only: a link can carry a token in its query string, and this shape is logged.
 */
function externalUrls(body: string): ResolvedSource[] {
  const hosts = new Set<string>();
  for (const raw of matchAll(body, URL_RE)) {
    const url = parseUrl(raw);
    if (!url || isGitHubHost(url.hostname)) continue;
    hosts.add(url.hostname);
  }
  return [...hosts]
    .slice(0, MAX_REFERENCES)
    .map((host) => makeSource('external_url', host, 'unreachable'));
}

/**
 * Read one file from the clone.
 *
 * `MockGitClient.readFile` (and some git ports) resolve a MISSING path to `''`
 * rather than rejecting, so blank content must be treated as absent — otherwise
 * every missing spec becomes a phantom `ok` source with zero characters.
 */
async function readRepoFile(input: SourceInput, path: string): Promise<string | null> {
  const raw = await input.git.readFile(input.repo, path).catch(() => null);
  return raw && raw.trim().length > 0 ? raw.slice(0, MAX_REPO_FILE_CHARS) : null;
}

function issueText(title: string, body: string | null | undefined): string {
  return `${title}\n\n${(body ?? '').slice(0, MAX_ISSUE_CHARS)}`.trim();
}

function isGitHubHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'github.com' || h === 'www.github.com';
}

function parseUrl(raw: string): URL | null {
  try {
    // Trailing punctuation from prose ("see https://x/y.") is not part of the URL.
    return new URL(raw.replace(/[.,;:]+$/, ''));
  } catch {
    return null;
  }
}

function matchAll(text: string, re: RegExp): string[] {
  // The shared constants are /g, so a fresh RegExp per call keeps `lastIndex`
  // from leaking between PRs (a classic source of "every other call misses").
  return [...text.matchAll(new RegExp(re.source, re.flags))].map((m) => m[0]);
}

/** One source per (kind, ref); the first resolution wins. */
function dedupe(sources: ResolvedSource[]): ResolvedSource[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = `${s.kind}:${s.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Keep the prompt bounded. Sources are in priority order (title, body, file map,
 * then everything fetched), so once the budget is spent, later CONTENT is
 * dropped — but the source itself stays in the list, downgraded to
 * `unreachable`, so the model is told it exists rather than being left to assume
 * it doesn't. `unreachable` is the honest label: from the model's side, a source
 * whose content was budgeted out is indistinguishable from one that 404'd, and
 * both should cap the confidence the same way.
 */
function fitBudget(sources: ResolvedSource[]): ResolvedSource[] {
  let spent = 0;
  return sources.map((s) => {
    if (s.status !== 'ok') return s;
    if (spent + s.content.length <= MAX_TOTAL_SOURCE_CHARS) {
      spent += s.content.length;
      return s;
    }
    const room = MAX_TOTAL_SOURCE_CHARS - spent;
    if (room <= 0) return makeSource(s.kind, s.ref, 'unreachable');
    spent = MAX_TOTAL_SOURCE_CHARS;
    return makeSource(s.kind, s.ref, 'ok', s.content.slice(0, room));
  });
}
