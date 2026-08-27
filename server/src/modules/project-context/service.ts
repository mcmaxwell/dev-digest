import type {
  AgentContext,
  ContextAttachment,
  ProjectDoc,
  ProjectDocBody,
  ProjectDocList,
  ProjectDocScan,
  RepoRef,
  SkillContext,
  SpecsReadEntry,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { ProjectContextRepository, type AttachmentRow } from './repository.js';
import { cloneRootExists, walkDocs } from './walk.js';
import { isInsideRoot, normalizeDocPath } from './paths.js';
import { applyRunBudget, dedupeByPath, orderAttachments, truncateAtHeading } from './assemble.js';
import { MAX_DOC_TOKENS, MAX_RUN_TOKENS, SCAN_JOB_KIND, SCAN_TIMEOUT_MS } from './constants.js';
import type { AttachmentRef, LoadedDoc } from './types.js';
// Cross-module reads through the documented composition seam: a module may
// construct another module's SERVICE (see .dependency-cruiser.cjs).
import { AgentsService } from '../agents/service.js';
import { SkillsService } from '../skills/service.js';

/**
 * Single-flight guard for the discovery scan, at MODULE scope because a service
 * is constructed per request. A second caller for the same repository awaits
 * the first instead of racing it into a half-written document set.
 *
 * Deliberately in memory rather than a `running` row: any table with a
 * `running` status needs a boot reaper, and a crashed process would otherwise
 * leave a permanently locked repository (server/INSIGHTS.md).
 */
const SCANS_IN_FLIGHT = new Map<string, Promise<void>>();

interface ScanPayload {
  repoId: string;
}

export interface AssembleForRunInput {
  agentId: string;
  repo: { id: string; owner: string; name: string };
  onLog?: (msg: string) => void;
}

export interface AssembledProjectContext {
  /** Document bodies, in order, ready to pass to the engine as `specs`. */
  bodies: string[];
  /** One entry per document the run CONSIDERED — including the omissions. */
  specsRead: SpecsReadEntry[];
}

/**
 * L05 — project context: discovery, reading, attachments and run assembly.
 *
 * Tenancy is this layer's job: none of the four tables carries a
 * `workspace_id`, so every HTTP entry point resolves its repository through
 * `container.reposRepo.getById(workspaceId, id)` and its agent/skill through
 * that module's service BEFORE the repository is touched.
 *
 * No `node:fs` here. The filesystem is reached through the `GitClient` port
 * (`clonePathFor`, `readFile`) and through `walk.ts`, which is this module's
 * pipeline file.
 */
export class ProjectContextService {
  private repo: ProjectContextRepository;

  constructor(private container: Container) {
    // Built from container.db, NOT a container getter — the repository is this
    // module's own (see server/INSIGHTS.md).
    this.repo = new ProjectContextRepository(container.db);
  }

  /**
   * Register the scan job handler on the JobRunner, with the per-kind budget a
   * background job needs (a ceiling below the honest worst case fails in the
   * worst way — `withTimeout` cannot cancel the work it abandons).
   */
  registerScanJobHandler(): void {
    this.container.jobs.register(
      SCAN_JOB_KIND,
      async (payload) => {
        await this.scan((payload as ScanPayload).repoId);
      },
      { timeoutMs: SCAN_TIMEOUT_MS },
    );
  }

  // ---- discovery ----------------------------------------------------------

  /**
   * Rebuild a repository's document list from its clone. Idempotent, and safe
   * to call concurrently: the second caller awaits the first.
   *
   * Never throws — a failure is persisted as scan status `error` and the page
   * renders it, because a broken scan must not fail the clone or resync job
   * that triggered it.
   */
  async scan(repoId: string): Promise<void> {
    const running = SCANS_IN_FLIGHT.get(repoId);
    if (running) return running;

    const promise = this.runScan(repoId).finally(() => {
      SCANS_IN_FLIGHT.delete(repoId);
    });
    SCANS_IN_FLIGHT.set(repoId, promise);
    return promise;
  }

  private async runScan(repoId: string): Promise<void> {
    try {
      const basics = await this.repo.repoBasics(repoId);
      if (!basics) return; // repository deleted between enqueue and run

      const ref: RepoRef = { owner: basics.owner, name: basics.name };
      const root = this.container.git.clonePathFor(ref);

      if (!basics.clonePath || !(await cloneRootExists(root))) {
        // The clone is the prerequisite; the page names it as the missing one.
        await this.repo.transaction(async (tx) => {
          await this.repo.replaceDocs(repoId, [], tx);
          await this.repo.upsertScan(
            repoId,
            {
              status: 'not_cloned',
              scannedAt: new Date(),
              docCount: 0,
              tokensTotal: 0,
              skippedTooLarge: 0,
              bounded: 0,
              error: null,
            },
            tx,
          );
        });
        return;
      }

      const result = await walkDocs(root);
      const tokensTotal = result.docs.reduce((sum, d) => sum + d.tokens, 0);

      // One transaction, so a concurrent list never sees a half-written set.
      await this.repo.transaction(async (tx) => {
        await this.repo.replaceDocs(repoId, result.docs, tx);
        await this.repo.upsertScan(
          repoId,
          {
            status: 'ok',
            scannedAt: new Date(),
            docCount: result.docs.length,
            tokensTotal,
            skippedTooLarge: result.skippedTooLarge,
            bounded: result.bounded,
            error: null,
          },
          tx,
        );
      });
    } catch (err) {
      await this.repo
        .upsertScan(repoId, {
          status: 'error',
          scannedAt: new Date(),
          docCount: 0,
          tokensTotal: 0,
          skippedTooLarge: 0,
          bounded: 0,
          error: err instanceof Error ? err.message : String(err),
        })
        .catch(() => undefined);
    }
  }

  /**
   * The repository's document list plus its scan status.
   *
   * A repository with no scan row at all (imported before L05, or whose queued
   * scan died with the process — `JobRunner` does not re-hydrate on boot) is
   * scanned lazily here, so the page is never permanently empty.
   */
  async list(workspaceId: string, repoId: string): Promise<ProjectDocList> {
    await this.requireRepo(workspaceId, repoId);

    let scanRow = await this.repo.getScan(repoId);
    if (!scanRow) {
      await this.scan(repoId);
      scanRow = await this.repo.getScan(repoId);
    }

    const [docs, usage] = await Promise.all([
      this.repo.listDocs(repoId),
      this.repo.usageCounts(repoId),
    ]);

    return {
      docs: docs.map<ProjectDoc>((d) => ({
        path: d.path,
        category: d.category as ProjectDoc['category'],
        size_bytes: d.sizeBytes,
        tokens: d.tokens,
        used_by_agents: usage.get(d.path) ?? 0,
      })),
      scan: toScanDto(scanRow),
    };
  }

  /** Re-run discovery, then return the fresh list (the toolbar's one action). */
  async refresh(workspaceId: string, repoId: string): Promise<ProjectDocList> {
    await this.requireRepo(workspaceId, repoId);
    await this.scan(repoId);
    return this.list(workspaceId, repoId);
  }

  /**
   * Read one document's body.
   *
   * The order below is the whole trust boundary, and NOTHING touches the
   * filesystem until all three checks pass:
   *   1. `normalizeDocPath` — a `../`, an absolute path or a non-`.md` name is
   *      a 422 (AC-47).
   *   2. `hasDoc` — a path the discovery globs never matched (`.env`,
   *      `.git/config`) is a 404 even when it exists on disk (AC-48).
   *   3. `isInsideRoot` — the second belt, because `SimpleGitClient.readFile`
   *      does a bare `join` with no traversal guard of its own.
   */
  async readDoc(workspaceId: string, repoId: string, rawPath: string): Promise<ProjectDocBody> {
    const repo = await this.requireRepo(workspaceId, repoId);

    const rel = normalizeDocPath(rawPath);
    if (!rel) throw new ValidationError('Not a project-document path');

    const doc = await this.repo.getDoc(repoId, rel);
    if (!doc) throw new NotFoundError('Document not found');

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    if (!isInsideRoot(this.container.git.clonePathFor(ref), rel)) {
      throw new ValidationError('Path resolves outside the repository clone');
    }

    const content = await this.container.git.readFile(ref, rel);
    const usage = await this.repo.usageCounts(repoId);

    return {
      path: doc.path,
      category: doc.category as ProjectDoc['category'],
      size_bytes: doc.sizeBytes,
      tokens: doc.tokens,
      used_by_agents: usage.get(doc.path) ?? 0,
      content,
    };
  }

  // ---- attachments --------------------------------------------------------

  /**
   * An agent's attachment set: its own documents in stored order, then the ones
   * it inherits from its ENABLED linked skills in link order.
   */
  async getAgentContext(
    workspaceId: string,
    agentId: string,
    activeRepoId: string | null,
  ): Promise<AgentContext> {
    const agent = await new AgentsService(this.container).get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const [directRows, linked] = await Promise.all([
      this.repo.agentDocs(agentId),
      this.container.agentsRepo.linkedSkills(agentId),
    ]);

    // A globally disabled skill contributes nothing, by the same rule L02 set
    // for skill bodies.
    const enabledSkills = linked.filter((l) => l.skill.enabled);
    const skillRows = await this.repo.skillDocsFor(enabledSkills.map((l) => l.skill.id));
    const bySkill = new Map<string, typeof skillRows>();
    for (const row of skillRows) {
      const list = bySkill.get(row.skillId) ?? [];
      list.push(row);
      bySkill.set(row.skillId, list);
    }

    const names = await this.repoNames(workspaceId);
    const docIndex = await this.repo.docIndexForRepos([
      ...new Set([...directRows, ...skillRows].map((r) => r.repoId)),
    ]);

    const direct = directRows.flatMap((row) =>
      toAttachment(row, 'direct', null, names, docIndex) ?? [],
    );
    const inherited = enabledSkills.flatMap(({ skill }) =>
      (bySkill.get(skill.id) ?? []).flatMap(
        (row) => toAttachment(row, 'skill', skill.name, names, docIndex) ?? [],
      ),
    );

    return {
      active_repo_id: activeRepoId,
      direct,
      inherited,
      available_count: activeRepoId ? await this.repo.countDocs(activeRepoId) : 0,
      tokens_total: sumTokens([...direct, ...inherited]),
    };
  }

  /**
   * Replace an agent's attachment set. Every incoming row is re-validated
   * BEFORE anything is written: an attachment stored today is trusted by the
   * run executor months from now, so a stored path must never be a traversal
   * and must never point at a repository outside the caller's workspace.
   *
   * Last write wins; there is no locking (the losing tab shows the persisted
   * set after its next load).
   */
  async setAgentDocs(
    workspaceId: string,
    agentId: string,
    docs: { repo_id: string; path: string }[],
    activeRepoId: string | null,
  ): Promise<AgentContext> {
    const agent = await new AgentsService(this.container).get(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const rows = await this.validateIncoming(workspaceId, docs);
    await this.repo.transaction((tx) => this.repo.replaceAgentDocs(agentId, rows, tx));
    return this.getAgentContext(workspaceId, agentId, activeRepoId);
  }

  /** A skill's attachment set. A skill inherits nothing. */
  async getSkillContext(workspaceId: string, skillId: string): Promise<SkillContext> {
    const skill = await new SkillsService(this.container).get(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');

    const rows = await this.repo.skillDocs(skillId);
    const names = await this.repoNames(workspaceId);
    const docIndex = await this.repo.docIndexForRepos([...new Set(rows.map((r) => r.repoId))]);
    const attachments = rows.flatMap(
      (row) => toAttachment(row, 'direct', null, names, docIndex) ?? [],
    );

    return { docs: attachments, tokens_total: sumTokens(attachments) };
  }

  async setSkillDocs(
    workspaceId: string,
    skillId: string,
    docs: { repo_id: string; path: string }[],
  ): Promise<SkillContext> {
    const skill = await new SkillsService(this.container).get(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');

    const rows = await this.validateIncoming(workspaceId, docs);
    await this.repo.transaction((tx) => this.repo.replaceSkillDocs(skillId, rows, tx));
    return this.getSkillContext(workspaceId, skillId);
  }

  // ---- run assembly -------------------------------------------------------

  /**
   * Resolve an agent's attachments into prompt-ready bodies for one run.
   *
   * Reads the clone DIRECTLY and never consults `project_docs`, so a run
   * started while a scan is in flight neither waits on it nor sees a
   * half-written list. The path checks that matter for safety
   * (`normalizeDocPath` + `isInsideRoot`) still run on every path; the
   * "is it in the current list" check does not, and cannot, because that is the
   * list this deliberately does not read.
   *
   * A read failure is per-document: it is logged, recorded as `missing`, and
   * the run continues.
   */
  async assembleForRun(input: AssembleForRunInput): Promise<AssembledProjectContext> {
    const { agentId, repo, onLog } = input;
    const log = onLog ?? (() => {});

    const [directRows, linked] = await Promise.all([
      this.repo.agentDocs(agentId),
      this.container.agentsRepo.linkedSkills(agentId),
    ]);
    const enabledSkills = linked.filter((l) => l.skill.enabled);
    const skillRows = await this.repo.skillDocsFor(enabledSkills.map((l) => l.skill.id));

    const direct: AttachmentRef[] = directRows.map((r) => ({
      repoId: r.repoId,
      path: r.path,
      origin: 'agent',
    }));
    // Skill-inherited documents follow the AGENT's skill-link order, which a
    // repository cannot know.
    const inherited: AttachmentRef[] = enabledSkills.flatMap(({ skill }) =>
      skillRows
        .filter((r) => r.skillId === skill.id)
        .map((r) => ({ repoId: r.repoId, path: r.path, origin: `skill:${skill.name}` })),
    );

    // Only this pull request's repository (AC-33), then first-position-wins.
    const candidates = dedupeByPath(
      orderAttachments(direct, inherited).filter((a) => a.repoId === repo.id),
    );
    if (candidates.length === 0) return { bodies: [], specsRead: [] };

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    const root = this.container.git.clonePathFor(ref);

    const specsRead: SpecsReadEntry[] = [];
    const loaded: LoadedDoc[] = [];

    for (const candidate of candidates) {
      const rel = normalizeDocPath(candidate.path);
      if (!rel || !isInsideRoot(root, rel)) {
        log(`project context: skipped ${candidate.path} — not a readable document path`);
        specsRead.push({ path: candidate.path, status: 'missing', tokens: 0, origin: candidate.origin });
        continue;
      }

      let raw: string | null = null;
      try {
        raw = await this.container.git.readFile(ref, rel);
      } catch {
        raw = null;
      }
      // A blank body counts as absent, not as an empty document: the mock git
      // client resolves a MISSING path to `''` rather than rejecting
      // (server/INSIGHTS.md), so "it threw" is not the only failure shape.
      if (raw === null || raw.trim().length === 0) {
        log(`project context: ${rel} could not be read — skipped`);
        specsRead.push({ path: rel, status: 'missing', tokens: 0, origin: candidate.origin });
        continue;
      }

      const cut = truncateAtHeading(raw, MAX_DOC_TOKENS);
      if (cut.truncated) {
        log(`project context: ${rel} truncated to ${cut.tokens} tokens (per-document ceiling)`);
      }
      loaded.push({ path: rel, origin: candidate.origin, tokens: cut.tokens, body: cut.text });
      specsRead.push({
        path: rel,
        status: cut.truncated ? 'truncated' : 'ok',
        tokens: cut.tokens,
        origin: candidate.origin,
      });
    }

    const { included, dropped } = applyRunBudget(loaded, MAX_RUN_TOKENS);
    for (const doc of dropped) {
      log(`project context: ${doc.path} dropped — run budget of ${MAX_RUN_TOKENS} tokens exhausted`);
      // The status enum carries no `dropped`; a document the run did not send
      // is recorded the same way as one it could not read, and the Live Log
      // line above is what names the reason.
      const entry = specsRead.find((e) => e.path === doc.path);
      if (entry) {
        entry.status = 'missing';
        entry.tokens = 0;
      }
    }

    return { bodies: included.map((d) => d.body), specsRead };
  }

  // ---- internals ----------------------------------------------------------

  /** Workspace-scoped repository resolution — the tenancy gate for every read. */
  private async requireRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<{ owner: string; name: string }> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
    return { owner: repo.owner, name: repo.name };
  }

  private async repoNames(workspaceId: string): Promise<Map<string, string>> {
    const repos = await this.container.reposRepo.list(workspaceId);
    return new Map(repos.map((r) => [r.id, r.fullName]));
  }

  /**
   * Validate an incoming attachment set and return the rows to store, in the
   * caller's order, deduped on `(repo_id, path)` — the storage key.
   */
  private async validateIncoming(
    workspaceId: string,
    docs: { repo_id: string; path: string }[],
  ): Promise<{ repoId: string; path: string }[]> {
    const out: { repoId: string; path: string }[] = [];
    const seen = new Set<string>();

    for (const doc of docs) {
      const repo = await this.container.reposRepo.getById(workspaceId, doc.repo_id);
      if (!repo) throw new NotFoundError('Repository not found');

      const rel = normalizeDocPath(doc.path);
      if (!rel) throw new ValidationError('Not a project-document path');
      if (!(await this.repo.hasDoc(doc.repo_id, rel))) {
        throw new NotFoundError('Document not found');
      }

      const key = `${doc.repo_id}\u0000${rel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ repoId: doc.repo_id, path: rel });
    }
    return out;
  }
}

/** The absence of a scan row is what the contract renders as status `never`. */
function toScanDto(row: Awaited<ReturnType<ProjectContextRepository['getScan']>>): ProjectDocScan {
  if (!row) {
    return {
      status: 'never',
      scanned_at: null,
      doc_count: 0,
      tokens_total: 0,
      skipped_too_large: 0,
      bounded: 0,
      error: null,
    };
  }
  return {
    status: row.status,
    scanned_at: row.scannedAt.toISOString(),
    doc_count: row.docCount,
    tokens_total: row.tokensTotal,
    skipped_too_large: row.skippedTooLarge,
    bounded: row.bounded,
    error: row.error,
  };
}

/**
 * One stored row rendered for a Context tab. Returns `null` for a repository
 * that is not in the caller's workspace — tenancy, not display logic.
 */
function toAttachment(
  row: AttachmentRow,
  origin: ContextAttachment['origin'],
  skillName: string | null,
  names: Map<string, string>,
  docIndex: Map<string, Map<string, number>>,
): ContextAttachment | null {
  const fullName = names.get(row.repoId);
  if (fullName === undefined) return null;
  const tokens = docIndex.get(row.repoId)?.get(row.path);
  return {
    repo_id: row.repoId,
    repo_full_name: fullName,
    path: row.path,
    tokens: tokens ?? 0,
    // Absent from the latest scan of its repository — the row stays, and stays
    // detachable.
    status: tokens === undefined ? 'missing' : 'ok',
    origin,
    skill_name: skillName,
  };
}

function sumTokens(rows: ContextAttachment[]): number {
  return rows.reduce((sum, r) => sum + r.tokens, 0);
}
