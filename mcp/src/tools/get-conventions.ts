import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { ConventionCandidate } from '../api/index.js';
import { describeApiError, unknownRepoMessage } from '../format/errors.js';
import { renderConvention } from '../format/render.js';
import { take } from '../format/truncate.js';
import {
  CATEGORY_DESC,
  EVIDENCE_DESC,
  LIMIT_RULES_DESC,
  STATUS_DESC,
  fail,
  ok,
  repoParam,
  type ToolDeps,
} from './shared.js';

/**
 * `a human has accepted` and `measured adherence rate` tell the model these are
 * grounded facts rather than another model's opinion. The second sentence says
 * WHEN to call it - without that, a read-only tool with no obvious trigger
 * simply never gets called.
 */
export const GET_CONVENTIONS_DESCRIPTION =
  'Return the coding conventions DevDigest extracted from a repository: house rules a human has accepted, each with a measured adherence rate. Read these before writing or reviewing code in that repo so the change matches the existing style.';

/** Mirrors `ConventionCategory` in the server contracts. */
const CATEGORIES = [
  'naming',
  'structure',
  'error-handling',
  'async',
  'imports',
  'types',
  'testing',
  'api-contract',
  'logging',
  'config',
] as const;

const MAX_CONVENTIONS_LIMIT = 100;

/**
 * `rejected` is deliberately absent from `status`, and `all` means accepted +
 * pending. A rejected candidate is a human saying "no"; handing it to a model
 * would make it apply a rule the team explicitly threw out.
 */
function selectByStatus(
  candidates: readonly ConventionCandidate[],
  status: 'accepted' | 'pending' | 'all',
): ConventionCandidate[] {
  if (status === 'accepted') return candidates.filter((c) => c.status === 'accepted');
  if (status === 'pending') return candidates.filter((c) => c.status === 'pending');
  return candidates.filter((c) => c.status === 'accepted' || c.status === 'pending');
}

/** accepted first, then measured adherence, then confidence: whatever survives
 *  `limit` should be the strongest rules, not an arbitrary page. */
export function sortConventions(candidates: readonly ConventionCandidate[]): ConventionCandidate[] {
  return [...candidates].sort((a, b) => {
    const byStatus = Number(b.status === 'accepted') - Number(a.status === 'accepted');
    if (byStatus !== 0) return byStatus;
    const byAdherence = (b.adherence ?? -1) - (a.adherence ?? -1);
    if (byAdherence !== 0) return byAdherence;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });
}

export function registerGetConventions(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'get_conventions',
    {
      description: GET_CONVENTIONS_DESCRIPTION,
      inputSchema: z.object({
        repo: repoParam,
        category: z.enum(CATEGORIES).optional().describe(CATEGORY_DESC),
        status: z.enum(['accepted', 'pending', 'all']).default('accepted').describe(STATUS_DESC),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_CONVENTIONS_LIMIT)
          .default(40)
          .describe(LIMIT_RULES_DESC),
        evidence: z.boolean().default(false).describe(EVIDENCE_DESC),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ repo, category, status, limit, evidence }) => {
      try {
        const resolved = await deps.resolvers.repo(repo);
        if (!resolved.ok) return fail(unknownRepoMessage(repo, resolved.known));

        const page = await deps.api.conventions(resolved.repo.id);

        if (!page.scan) {
          return ok(
            `DevDigest has never extracted conventions from ${resolved.repo.full_name}. Run the ` +
              `extractor at http://localhost:3000/conventions (it samples the clone and proposes ` +
              `rules), accept the ones that hold, then call get_conventions again.`,
          );
        }

        // A running or failed scan does not hide the rules already accepted -
        // stale house rules beat none, as long as the caller is told they are stale.
        const prefix =
          page.scan.status === 'running'
            ? `NOTE: a conventions scan is running right now, so this list may still grow.\n\n`
            : page.scan.status === 'error'
              ? `NOTE: the last conventions scan failed (${page.scan.error ?? 'no reason recorded'}); these are the rules from before it.\n\n`
              : '';

        const byStatus = selectByStatus(page.candidates, status);
        const accepted = page.candidates.filter((c) => c.status === 'accepted').length;
        const pending = page.candidates.filter((c) => c.status === 'pending').length;

        if (byStatus.length === 0) {
          const hint =
            status === 'accepted' && pending > 0
              ? `No conventions have been accepted for ${resolved.repo.full_name} yet, but ${pending} candidates are waiting for review at http://localhost:3000/conventions. Accept the ones that hold, or call this tool with status="all" to see them unreviewed.`
              : `DevDigest has no ${status === 'all' ? 'accepted or pending' : status} conventions for ${resolved.repo.full_name}. Run the extractor at http://localhost:3000/conventions, then retry.`;
          return ok(prefix + hint);
        }

        const filtered = category ? byStatus.filter((c) => c.category === category) : byStatus;
        if (filtered.length === 0) {
          const present = [...new Set(byStatus.map((c) => c.category))].sort().join(', ');
          return ok(
            `${prefix}No "${category}" conventions for ${resolved.repo.full_name}. Categories ` +
              `that do have rules: ${present}. Call again without category to see all of them.`,
          );
        }

        const { shown, total, withheld } = take(sortConventions(filtered), limit);
        const head =
          `${resolved.repo.full_name}: ${shown.length} of ${total} conventions ` +
          `(status=${status}${category ? `, category=${category}` : ''}; ` +
          `${accepted} accepted, ${pending} pending in total).`;
        const tail =
          withheld > 0
            ? `\n\n${withheld} more were withheld; raise limit (max ${MAX_CONVENTIONS_LIMIT}) or narrow with category.`
            : '';

        return ok(
          prefix +
            [head, '', ...shown.map((c) => renderConvention(c, evidence))].join('\n') +
            tail,
        );
      } catch (err) {
        return fail(describeApiError(err));
      }
    },
  );
}
