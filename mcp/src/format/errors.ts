import { ApiError, ApiShapeError, ApiTimeoutError, ApiUnreachableError } from '../api/index.js';

/**
 * Every failure the model can see is written HERE, in one place, and every
 * message names the next action. The rule is not politeness: an MCP error is
 * something the model reads and acts on, so "Repository not found" makes it
 * guess, while "call list_agents / pass repo as owner/name" makes it recover in
 * one turn instead of three.
 *
 * These strings cost NOTHING at session start - unlike tool descriptions, an
 * error body is only paid for when it actually fires (see AGENTS.md).
 */

export function describeApiError(err: unknown): string {
  if (
    err instanceof ApiUnreachableError ||
    err instanceof ApiTimeoutError
  ) {
    return err.message;
  }

  if (err instanceof ApiShapeError) {
    return (
      `The DevDigest API answered ${err.path} in a shape this MCP server does not understand ` +
      `(${err.detail}). The API and the mcp/ package are out of sync - pull the latest repo ` +
      `and restart both.`
    );
  }

  if (err instanceof ApiError) {
    // MATCH ON STATUS, NOT ON CODE. @fastify/rate-limit's 429 is not an
    // AppError, so it falls through the generic branch of the error handler and
    // arrives with code "internal_error". Keying on the code would report a
    // rate limit as a server crash.
    if (err.status === 429) {
      return (
        `DevDigest is rate limiting this client (HTTP 429). Starting a review is capped at ` +
        `10 per minute and every other endpoint at 120. Wait about a minute, then retry - ` +
        `nothing was lost.`
      );
    }
    switch (err.code) {
      case 'not_found':
        return (
          `DevDigest could not find that: ${err.message}. Re-check the identifiers - ` +
          `call list_agents for agents, and pass repo as "owner/name" exactly as DevDigest ` +
          `lists it.`
        );
      case 'validation_error':
        return `DevDigest rejected the request as invalid: ${err.message}. Fix the arguments and call the tool again.`;
      case 'invalid_run_request':
        return (
          `DevDigest rejected the run request: ${err.message}. Call list_agents and pass one ` +
          `agent slug or id from that list.`
        );
      case 'scan_in_progress':
        return (
          `A conventions scan is already running on that repository: ${err.message}. Wait for ` +
          `it to finish, then call get_conventions again.`
        );
      case 'github_unavailable':
        return (
          `DevDigest could not reach GitHub: ${err.message}. Check the GITHUB_TOKEN in ` +
          `~/.devdigest/secrets.json, then retry - nothing was changed.`
        );
      case 'repo_not_cloned':
        return (
          `That repository has no local clone yet: ${err.message}. Open it once in the ` +
          `DevDigest UI (or POST /repos/:id/refresh) so it gets cloned, then retry.`
        );
      default:
        return (
          `The DevDigest API returned HTTP ${err.status} (${err.code}): ${err.message}. Retry ` +
          `once; if it persists, read the API log in the terminal running ./scripts/dev.sh.`
        );
    }
  }

  const detail = err instanceof Error ? err.message : String(err);
  return `Unexpected failure talking to DevDigest: ${detail}. Retry once, then check that ./scripts/dev.sh is still running.`;
}

/** The repo the caller named is not one DevDigest has imported. */
export function unknownRepoMessage(repo: string, known: readonly string[]): string {
  if (known.length === 0) {
    return (
      `DevDigest has no repositories imported yet, so "${repo}" cannot be resolved. Import one ` +
      `at http://localhost:3000 (paste the GitHub URL), then retry.`
    );
  }
  return (
    `DevDigest has no repository "${repo}". Imported repositories: ${known.join(', ')}. ` +
    `Pass one of those as "owner/name", or import "${repo}" at http://localhost:3000 first.`
  );
}

/** The PR number is not one of the PRs imported for that repo. */
export function pullNotImportedMessage(repo: string, prNumber: number): string {
  return (
    `Pull request ${repo}#${prNumber} has not been imported into DevDigest. There is no ` +
    `fallback that fetches a PR from GitHub by number - open the repository at ` +
    `http://localhost:3000, let it sync its pull requests, then call this tool again.`
  );
}

export function unknownAgentMessage(ref: string, known: readonly string[]): string {
  if (known.length === 0) {
    return (
      `This DevDigest workspace has no reviewer agents, so "${ref}" cannot be resolved. Create ` +
      `one at http://localhost:3000/agents, then retry.`
    );
  }
  return (
    `No reviewer agent matches "${ref}". Known agents: ${known.join(', ')}. Call list_agents ` +
    `for the full list with ids, then pass one of those.`
  );
}

export function ambiguousAgentMessage(
  slug: string,
  matches: readonly { id: string; name: string }[],
): string {
  const rows = matches.map((m) => `${m.name} (id=${m.id})`).join('; ');
  return (
    `"${slug}" matches ${matches.length} agents, so this tool will not guess which one to bill: ` +
    `${rows}. Call it again with the id instead of the slug.`
  );
}
