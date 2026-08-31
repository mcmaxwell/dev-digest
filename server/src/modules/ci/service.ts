import {
  CiTrigger,
  type CiBundle,
  type CiBundleInput,
  type CiExport,
  type CiExportInput,
  type CiFile,
  type CiInstallation,
  type CiRun,
  type CiRunInput,
  type CiRunResult,
  type RepoRef,
  type ReviewDiffResponse,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { CiInstallationRow, CiRunRow } from '../../db/rows.js';
import { ReviewService } from '../reviews/service.js';
import { buildBundle, type BundleAgent } from './bundle.js';
import { CiRepository } from './repository.js';
import {
  CI_BRANCH,
  CI_COMMIT_MESSAGE,
  CI_PR_BODY,
  CI_PR_TITLE,
  CI_RUNS_PAGE_LIMIT,
  failOnToSeverity,
  parseRepoRef,
} from './constants.js';

/** Minimal structured logger (pino-compatible: (obj, msg)). */
type Logger = { info: (obj: unknown, msg?: string) => void };

/**
 * L06 Export to CI - the I/O half.
 *
 * Two operations over the same generated files:
 *  - `bundle()` is a PURE DERIVATION of the agent: it loads the agent and its
 *    skills, hands them to `buildBundle`, and returns the files. Nothing is
 *    persisted, so exporting twice is indistinguishable from exporting once.
 *  - `export()` is the installing counterpart: the same files, committed to a
 *    branch of a real repository behind a pull request, plus the
 *    `ci_installations` row that records the agent is live there.
 *
 * Skills are read through `container.agentsRepo` - the documented cross-module
 * seam - rather than by importing the agents module's repository, and GitHub is
 * reached only through `container.github()`, never a concrete client.
 */
export class CiService {
  private repo: CiRepository;

  constructor(private container: Container) {
    this.repo = new CiRepository(container.db);
  }

  async bundle(workspaceId: string, agentId: string, input: CiBundleInput): Promise<CiBundle> {
    const { agent, skills } = await this.loadAgent(workspaceId, agentId);
    return { files: buildBundle(agent, skills, input) };
  }

  /**
   * Install the agent into a repository.
   *
   * `action: "open_pr"` commits the generated files onto `devdigest/ci` as one
   * atomic commit and opens (or reuses) the pull request that merges them;
   * `action: "files"` records the installation and returns the same files
   * without touching GitHub at all. Either way the `ci_installations` row for
   * `(agent, repo)` is created at most once - a second export of the same pair
   * returns the first row and, because `findOpenPr` is consulted before
   * `openPullRequest`, does not open a second pull request.
   */
  async export(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    const ref = parseRepoRef(input.repo);
    if (!ref) {
      throw new AppError(
        'invalid_repo',
        `"${input.repo}" is not a repository. Use the "owner/name" form, e.g. "acme/payments-api".`,
        400,
      );
    }

    const { agent, skills, row: agentRow } = await this.loadAgent(workspaceId, agentId);
    const files = buildBundle(agent, skills, {
      target: input.target,
      triggers: this.triggersOf(input.triggers),
      post_as: input.post_as,
    });

    const pr_url = input.action === 'open_pr' ? await this.publish(ref, input.base, files) : null;

    // One transaction around the read-then-insert: `ci_installations` has no
    // unique index on `(agent_id, repo)`, so the pair of statements is the only
    // thing keeping a double click from recording the repository twice.
    const row = await this.repo.transaction((tx) =>
      this.repo.upsertInstallation(
        { agentId: agentRow.id, repo: input.repo, targetType: input.target },
        tx,
      ),
    );

    return { installation: toInstallation(row), files, pr_url };
  }

  /** Every repository this agent is installed into. */
  async installations(workspaceId: string, agentId: string): Promise<CiInstallation[]> {
    const row = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!row) throw new NotFoundError('Agent not found');

    const rows = await this.repo.listInstallationsForAgent(agentId);
    return rows.map(toInstallation);
  }

  /**
   * The workspace's CI runs, newest first.
   *
   * Capped rather than paged: `ci_runs` has no index beyond its primary key, and
   * the page's four filters run client-side over exactly this list. When the cap
   * starts biting, the fix is an index and real pagination, not a bigger number.
   */
  async runs(workspaceId: string): Promise<CiRun[]> {
    const rows = await this.repo.listRuns(workspaceId, CI_RUNS_PAGE_LIMIT);
    return rows.map((r) => toRun(r.run, r.repo, r.agent));
  }

  /**
   * Ingest one CI run: review the diff, post the review, record the row.
   *
   * THE INSTALLATION IS THE ONLY GATE. This server has no authentication of any
   * kind (`LocalNoAuthProvider` resolves a fixed user and workspace for every
   * request), and this endpoint both spends model budget and writes to GitHub
   * with the user's PAT - so it refuses any repository the workspace has not
   * deliberately installed an agent into. That, the route's rate limit and its
   * body limit are the containment; see the plan's security note.
   *
   * A GitHub failure does NOT lose the run: posting is best-effort and reported
   * as `posted: false`, because the review has already been paid for and the
   * CI Runs page is the only place it would ever be seen again.
   */
  async recordRun(workspaceId: string, input: CiRunInput, logger?: Logger): Promise<CiRunResult> {
    const ref = parseRepoRef(input.repo);
    if (!ref) {
      throw new AppError(
        'invalid_repo',
        `"${input.repo}" is not a repository. Use the "owner/name" form, e.g. "acme/payments-api".`,
        400,
      );
    }

    const installation = await this.repo.installationForRepo(workspaceId, input.repo);
    if (!installation) {
      throw new NotFoundError(
        `No agent is installed into ${input.repo}. Export the agent to CI first.`,
      );
    }

    // The gate is the INSTALLED agent's, not the reviewing agent's: the run is
    // attributed to the installation, and `fail_on` on the wire overrides both.
    const installed = await this.container.agentsRepo.getById(workspaceId, installation.agentId);
    const fail_on = input.fail_on ?? (installed ? failOnToSeverity(installed.ciFailOn) : undefined);

    const review = await new ReviewService(this.container).diff(
      workspaceId,
      { diff: input.diff, agent: input.agent, fail_on, source: 'other' },
      logger,
    );

    const posted = await this.post(ref, input, review, logger);

    const row = await this.repo.insertRun({
      ciInstallationId: installation.id,
      prNumber: input.pr_number,
      ranAt: new Date(),
      status: runStatus(review),
      findingsCount: review.findings.length,
      costUsd: review.usage.cost_usd,
      githubUrl: input.github_url ?? null,
      source: 'gha',
    });

    return { run: toRun(row, installation.repo, review.agent.name), review, posted };
  }

  /**
   * Post the review to the pull request. Never throws: GitHub being down, the
   * token being unset or the PR being closed must not cost the caller the run
   * it already paid for, so the failure becomes `posted: false` plus a log line.
   */
  private async post(
    ref: RepoRef,
    input: CiRunInput,
    review: ReviewDiffResponse,
    logger?: Logger,
  ): Promise<boolean> {
    if (input.post_as === 'none') return false;

    try {
      const github = await this.container.github();
      await github.postReview(ref, input.pr_number, {
        body: reviewBody(review),
        // A PR comment is a review that takes no position; only a `github_review`
        // is allowed to request changes, and only when the gate actually fired.
        event:
          input.post_as === 'github_review' && review.blockers > 0 ? 'REQUEST_CHANGES' : 'COMMENT',
      });
      return true;
    } catch (err) {
      logger?.info(
        { repo: input.repo, pr: input.pr_number, err: String(err) },
        'ci run recorded, but posting the review to GitHub failed',
      );
      return false;
    }
  }

  /**
   * Commit the files and return the pull request's URL.
   *
   * `commitFiles` is idempotent (it creates `devdigest/ci` from `base` when it
   * is missing and fast-forwards it otherwise), and `findOpenPr` runs before
   * `openPullRequest` so re-installing updates the existing PR instead of
   * stacking a second one on the same branch.
   */
  private async publish(
    ref: { owner: string; name: string },
    base: string,
    files: CiFile[],
  ): Promise<string> {
    const github = await this.container.github();
    await github.commitFiles(ref, {
      branch: CI_BRANCH,
      base,
      message: CI_COMMIT_MESSAGE,
      files: files.map((f) => ({ path: f.path, contents: f.contents })),
    });

    const existing = await github.findOpenPr(ref, CI_BRANCH);
    if (existing) return existing.url;

    const opened = await github.openPullRequest(ref, {
      title: CI_PR_TITLE,
      head: CI_BRANCH,
      base,
      body: CI_PR_BODY,
    });
    return opened.url;
  }

  /** The agent as `buildBundle` wants it, plus its linked skills. 404 if absent. */
  private async loadAgent(workspaceId: string, agentId: string) {
    const row = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!row) throw new NotFoundError('Agent not found');

    const linked = await this.container.agentsRepo.linkedSkills(agentId);

    const agent: BundleAgent = {
      id: row.id,
      name: row.name,
      provider: row.provider,
      model: row.model,
      system_prompt: row.systemPrompt,
      strategy: row.strategy,
      ci_fail_on: row.ciFailOn,
    };

    // Bodies go into the bundle VERBATIM. `_shared/skills.ts` wraps a non-manual
    // body in untrusted-content fencing before it reaches a model prompt; a
    // Markdown file on disk has no prompt to be injected into, and fencing it
    // would corrupt the file the user is about to commit.
    const skills = linked.map((l) => ({
      name: l.skill.name,
      body: l.skill.body,
      enabled: l.skill.enabled,
    }));

    return { agent, skills, row };
  }

  /**
   * `CiExportInput.triggers` is a loose `string[]` on the wire (it predates
   * `CiTrigger` and is not this iteration's to reshape), so the unknown values
   * are refused here rather than silently dropped by `buildBundle` - a workflow
   * with an empty `types:` list never fires and would look installed.
   */
  private triggersOf(triggers: string[]): CiTrigger[] {
    const parsed = triggers.map((raw) => {
      const trigger = CiTrigger.safeParse(raw);
      if (!trigger.success) {
        throw new AppError(
          'unsupported_ci_trigger',
          `"${raw}" is not a pull-request trigger. Use ${CiTrigger.options.join(', ')}.`,
          400,
        );
      }
      return trigger.data;
    });
    if (parsed.length === 0) {
      throw new AppError(
        'no_ci_triggers',
        'Pick at least one trigger, or the workflow would never run.',
        400,
      );
    }
    return parsed;
  }
}

/** `ci_installations` row -> the wire shape. */
function toInstallation(row: CiInstallationRow): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
  };
}

/** `ci_runs` row -> the wire shape, with the two joined columns filled in. */
function toRun(row: CiRunRow, repo: string | null, agent: string | null): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    pr_number: row.prNumber,
    ran_at: row.ranAt?.toISOString() ?? null,
    status: row.status,
    findings_count: row.findingsCount,
    cost_usd: row.costUsd,
    github_url: row.githubUrl,
    source: row.source,
    agent,
    repo,
  };
}

/**
 * The run's status, from the review alone.
 *
 * `failed` means the GATE fired, not that anything errored - an errored run
 * never gets here, because `ReviewService.diff` throws and the route answers 5xx. The
 * three values are the ones `CiRunStatus` defines minus `running`, which this
 * push-based ingest never observes: the run is over by the time it arrives.
 */
function runStatus(review: ReviewDiffResponse): string {
  if (review.blockers > 0) return 'failed';
  if (review.findings.length === 0) return 'no_findings';
  return 'succeeded';
}

/**
 * The review as the markdown body of a GitHub review.
 *
 * Model-authored text (titles, rationales) is rendered as markdown, exactly as
 * it already is in the studio - GitHub renders no scripts, and the alternative
 * (escaping it) would mangle the code spans that make a finding readable. What
 * is NOT interpolated anywhere is a shell command or an API path.
 */
function reviewBody(review: ReviewDiffResponse): string {
  const lines = [
    `**DevDigest review** - ${review.agent.name} (${review.agent.model})`,
    '',
    review.summary,
    '',
  ];

  for (const f of review.findings) {
    lines.push(
      `### ${f.severity} - ${f.title}`,
      '',
      `\`${f.file}\`:${f.start_line}-${f.end_line}`,
      '',
      f.rationale,
      '',
    );
  }

  if (review.findings.length === 0) lines.push('No findings.', '');
  lines.push(
    `_${review.findings.length} finding(s), ${review.blockers} blocking · grounding ${review.grounding} · ${review.files_reviewed} file(s) reviewed._`,
  );
  return lines.join('\n');
}
