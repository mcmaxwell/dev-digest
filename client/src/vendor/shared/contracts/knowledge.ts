import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding (L06 — Onboarding Tour) ----
/**
 * One generated, grounded tour per imported repository: five fixed sections,
 * their rows, the provenance that pins every link to a commit, and the usage
 * record that makes "exactly one model call" falsifiable from the page.
 *
 * These are the PERSISTED and READ shapes. What the model is asked to return is
 * a different, flatter schema (`modules/onboarding/schemas.ts`): rows there are
 * unverified, ordinals and rank percentiles are ours, and provenance and usage
 * are ours. The two must not be merged.
 */
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

/** The five sections, in the order the page renders them. */
export const OnboardingSectionKind = z.enum([
  'architecture',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
]);
export type OnboardingSectionKind = z.infer<typeof OnboardingSectionKind>;

/**
 * Per-section state. `no_graph` is not a failure: the section was built from
 * directory prominence and entry-point heuristics because the import graph was
 * unavailable, and the page says so rather than pretending otherwise.
 */
export const OnboardingSectionStatus = z.enum(['ok', 'empty', 'no_graph']);
export type OnboardingSectionStatus = z.infer<typeof OnboardingSectionStatus>;

/**
 * Why a stored tour is less than a full one.
 *
 * `clone_unavailable` is deliberately NOT folded into `model_failed`: the
 * generation runs on a queue, so the clone the request checked can be mid-resync
 * or gone by the time the job reads it, and reporting that as a model failure
 * would blame the model for a disk. It is the only reason that means "no facts
 * were collected at all".
 */
export const OnboardingDegradedReason = z.enum([
  'no_index',
  'partial_index',
  'repo_too_large',
  'model_failed',
  'issues_unavailable',
  'clone_unavailable',
]);
export type OnboardingDegradedReason = z.infer<typeof OnboardingDegradedReason>;

export const OnboardingCriticalPath = z.object({
  path: z.string(),
  reason: z.string(),
  /** From `repoIntel.getFileRank`; null when the graph could not supply one. */
  rank_percentile: z.number().nullable(),
});
export type OnboardingCriticalPath = z.infer<typeof OnboardingCriticalPath>;

export const OnboardingRunStep = z.object({
  step: z.number().int().positive(),
  command: z.string(),
  /** The repo-relative file the command was read from — the reader's check. */
  source: z.string(),
});
export type OnboardingRunStep = z.infer<typeof OnboardingRunStep>;

export const OnboardingReadingEntry = z.object({
  order: z.number().int().positive(),
  path: z.string(),
  reason: z.string(),
});
export type OnboardingReadingEntry = z.infer<typeof OnboardingReadingEntry>;

export const OnboardingFirstTask = z.object({
  title: z.string(),
  origin: z.enum(['todo', 'issue']),
  path: z.string().nullish(),
  line: z.number().int().positive().nullish(),
  issue_number: z.number().int().positive().nullish(),
});
export type OnboardingFirstTask = z.infer<typeof OnboardingFirstTask>;

const OnboardingSectionBase = z.object({
  title: z.string(),
  body: z.string(), // markdown
  status: OnboardingSectionStatus,
  /** Up to a handful of supporting files; every one verified to exist. */
  links: z.array(OnboardingLink),
});

/**
 * A discriminated union HERE is deliberate and safe: no model ever sees this
 * schema. The model's own schema stays flat (a `oneOf` degrades output badly);
 * this one is what the page narrows on.
 */
export const OnboardingSection = z.discriminatedUnion('kind', [
  OnboardingSectionBase.extend({
    kind: z.literal('architecture'),
    /** Mermaid source. Permitted on this section and no other. */
    diagram: z.string().nullish(),
  }),
  OnboardingSectionBase.extend({
    kind: z.literal('critical_paths'),
    items: z.array(OnboardingCriticalPath),
  }),
  OnboardingSectionBase.extend({
    kind: z.literal('run_locally'),
    items: z.array(OnboardingRunStep),
  }),
  OnboardingSectionBase.extend({
    kind: z.literal('reading_path'),
    items: z.array(OnboardingReadingEntry),
  }),
  OnboardingSectionBase.extend({
    kind: z.literal('first_tasks'),
    items: z.array(OnboardingFirstTask),
  }),
]);
export type OnboardingSection = z.infer<typeof OnboardingSection>;

/**
 * What one generation cost. `calls` is always 1 — it is on the record so the
 * page can state it rather than the reader having to grep a log. Token and cost
 * fields are nullable because a failed call still produces a usage record, and
 * because not every provider prices its own output.
 */
export const OnboardingUsage = z.object({
  calls: z.number().int(),
  provider: z.string(),
  model: z.string(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  attempts: z.number().int(),
  duration_ms: z.number().int(),
});
export type OnboardingUsage = z.infer<typeof OnboardingUsage>;

/**
 * `sections` is deliberately NOT length-constrained. Five sections are
 * guaranteed by the assembler; a `.length(5)` here would turn a malformed
 * STORED document into a thrown response, and a tour must never render as an
 * error page.
 */
export const Onboarding = z.object({
  repo_id: z.string(),
  status: z.enum(['ready', 'degraded']),
  degraded_reasons: z.array(OnboardingDegradedReason),
  /** The commit the clone stood at when facts were collected; links pin to it. */
  head_sha: z.string(),
  /** What repo-intel last indexed, which may lag `head_sha`. */
  index_sha: z.string().nullable(),
  files_indexed: z.number().int(),
  files_skipped: z.number().int(),
  excerpts_used: z.number().int(),
  /** Rows and steps the verification pass dropped for citing a missing path. */
  dropped_rows: z.number().int(),
  dropped_steps: z.number().int(),
  generated_at: z.string(),
  sections: z.array(OnboardingSection),
  usage: OnboardingUsage.nullable(),
});
export type Onboarding = z.infer<typeof Onboarding>;

/**
 * In-flight state. Not persisted: an in-memory single-flight guard dies with
 * the process, which is the correct behaviour for a running-generation lock (a
 * `running` ROW would need a boot reaper).
 */
export const OnboardingGeneration = z.object({
  status: z.enum(['idle', 'running']),
  phase: z.enum(['facts', 'graph', 'markers', 'issues', 'model', 'verifying']).nullable(),
  started_at: z.string().nullable(),
});
export type OnboardingGeneration = z.infer<typeof OnboardingGeneration>;

/** GET /repos/:id/onboarding — the whole page in one read. */
export const OnboardingPage = z.object({
  repo_id: z.string(),
  clone: z.enum(['ready', 'absent']),
  tour: Onboarding.nullable(),
  generation: OnboardingGeneration,
  current_head_sha: z.string().nullable(),
  stale: z.boolean(),
  /**
   * How far the clone's head has moved past the tour's. Null when the tour's
   * sha is not reachable from the current head — a depth-1 clone that has never
   * been resynced has no history to count through, and this feature does not
   * put a GitHub round trip on a read path to invent one.
   */
  commits_behind: z.number().int().nullable(),
});
export type OnboardingPage = z.infer<typeof OnboardingPage>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum([
  'manual',
  'imported_file',
  'imported_url',
  'extracted',
  'community',
]);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

// One immutable body snapshot from `skill_versions` (recorded on create and on
// every body-changing save). The current `skills.body` always equals the
// newest snapshot; rollback restores an old body AS A NEW version.
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

// Usage statistics for one skill, derived transitively via the agents it is
// attached to (runs record the rendered prompt, not skill ids, so per-run
// attribution is by linkage): those agents' runs and review findings.
export const SkillStats = z.object({
  agents: z.array(z.object({ id: z.string(), name: z.string(), enabled: z.boolean() })),
  runs_count: z.number().int(),
  last_run_at: z.string().nullable(),
  findings_count: z.number().int(),
  accepted_count: z.number().int(),
  dismissed_count: z.number().int(),
});
export type SkillStats = z.infer<typeof SkillStats>;

// What the import endpoint extracts from an uploaded .md / .zip BEFORE anything
// is persisted: the markdown core + optional frontmatter-derived fields, plus
// which archive entries were skipped (non-markdown — never read, never executed).
export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType.nullish(),
  body: z.string(),
  warnings: z.array(z.string()),
  skipped_entries: z.array(z.string()),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions (L02 — Conventions Extractor) ----
/**
 * The lens an extraction pass looked through. One LLM call per category (the
 * fan-out) — a single "find the conventions" call returns a handful of vague
 * rules, one scoped call per category returns specific ones.
 */
export const ConventionCategory = z.enum([
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
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/** User verdict on a candidate. Survives a re-scan (upsert keeps the status). */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/**
 * Where the candidate came from:
 *  - `config` — derived deterministically from eslint/tsconfig/prettier/package.json
 *    (no model involved, so it cannot be hallucinated),
 *  - `llm`    — proposed by an extraction pass and then grounded against the clone.
 */
export const ConventionOrigin = z.enum(['llm', 'config']);
export type ConventionOrigin = z.infer<typeof ConventionOrigin>;

/**
 * One grounded occurrence of the rule. `verified` records HOW it was grounded:
 * `exact` — the snippet sits at the cited line; `relocated` — the snippet exists
 * in the file but at a different line (we corrected it). Evidence that cannot be
 * found in the clone at all is dropped before persisting, never stored.
 */
export const ConventionEvidence = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  snippet: z.string(),
  verified: z.enum(['exact', 'relocated']),
  /**
   * Commit the snippet was verified at — what pins a GitHub permalink that
   * stays correct after the branch moves. Nullish for rows written before the
   * field existed (the UI then renders plain text instead of a link).
   */
  sha: z.string().nullish(),
});
export type ConventionEvidence = z.infer<typeof ConventionEvidence>;

export const ConventionCandidate = z.object({
  id: z.string(),
  category: ConventionCategory,
  rule: z.string(),
  rationale: z.string().nullish(),
  /** At least one VERIFIED occurrence; `llm`-origin candidates need two. */
  evidence: z.array(ConventionEvidence),
  /** The model's own confidence (or 1 for `config` origin). */
  confidence: z.number().min(0).max(1),
  /**
   * MEASURED conformance: conforming matches / (conforming + violating), from
   * running the candidate's counter-example probe over the clone. Null when the
   * candidate shipped no probe — "the model believes it" instead of "the repo
   * does it 94% of the time".
   */
  adherence: z.number().min(0).max(1).nullish(),
  support: z.number().int().nullish(),
  violations: z.number().int().nullish(),
  origin: ConventionOrigin,
  status: ConventionStatus,
  /** The user rewrote the rule text — the skill body uses THEIR wording. */
  edited: z.boolean(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/** One extraction run over a repo. Drives the "last scan" header + busy state. */
export const ConventionScan = z.object({
  id: z.string(),
  repo_id: z.string(),
  status: z.enum(['running', 'done', 'error']),
  /** Commit the samples were read at — later candidates render as stale. */
  sha: z.string().nullish(),
  provider: z.string().nullish(),
  model: z.string().nullish(),
  sample_count: z.number().int(),
  candidate_count: z.number().int(),
  error: z.string().nullish(),
  started_at: z.string(),
  finished_at: z.string().nullish(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

/** GET /repos/:id/conventions — the whole page in one read. */
export const ConventionsPage = z.object({
  scan: ConventionScan.nullable(),
  candidates: z.array(ConventionCandidate),
});
export type ConventionsPage = z.infer<typeof ConventionsPage>;

/**
 * A skill rendered from accepted candidates. Persists NOTHING — the modal shows
 * it, the user edits it, and saving goes through the ordinary POST /skills.
 */
export const ConventionSkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  /** Candidate ids merged into this draft (one draft per category in split mode). */
  candidate_ids: z.array(z.string()),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
  // Number of skills linked to this agent (computed on read; absent on writes).
  skill_count: z.number().int().nullish(),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
