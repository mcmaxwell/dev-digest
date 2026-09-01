import type { AgentColumn, Conflict, ConflictTake, FindingRecord, Severity } from '@devdigest/shared';
import { overlaps } from '../_shared/overlap.js';

/**
 * L07 - the multi-agent comparison, as pure functions.
 *
 * PURE: no Container, no adapter, no `db/`, no review engine. That is the whole
 * claim of the disagreement section - "the agents disagree here" is DERIVED from
 * findings that already exist, not asked of a model - so it is enforced
 * mechanically by the `multi-agent-clustering-is-pure` rule in
 * `.dependency-cruiser.cjs`, exactly as L06 enforced the same claim for the eval
 * scorer. If something here genuinely needs I/O, it is not a comparison rule and
 * belongs in the service, which already has it.
 *
 * Cost: at most (total findings)^2 file-and-range comparisons with no I/O -
 * 10 agents at 20 findings each is 200 x 200, which is microseconds.
 */

/** How an agent stands on one cluster. */
export type Stance = Severity | 'did_not_flag' | 'no_opinion';

/** One agent's findings, in the order the run fixes (see `byAgentOrder`). */
export interface AgentFindings {
  agent_id: string;
  agent_name: string;
  /** The run's terminal state; a non-`done` run can hold no opinion. */
  status: AgentColumn['status'];
  findings: FindingRecord[];
}

/** A set of findings on one file whose line ranges overlap. Computed, never stored. */
export interface Cluster {
  file: string;
  /** Every finding in the cluster, paired with the agent that produced it. */
  members: { agent_id: string; finding: FindingRecord }[];
}

/** Severity, most severe first - the order titles and cells are decided by. */
const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/**
 * THE order of the agents in a run, used by every surface that shows them.
 *
 * Agent name ascending, then `run_id` ascending for a run whose agent was
 * deleted (two of those would otherwise be interchangeable). This is decided
 * HERE because `AgentsRepository.listEnabled` has no `orderBy` at all, so
 * Postgres returns enabled agents in an arbitrary order and "the order of the
 * agents in the run" would not otherwise be reproducible across two reads of
 * the same run.
 */
export function byAgentOrder<T extends { agent_name: string; run_id: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => a.agent_name.localeCompare(b.agent_name) || a.run_id.localeCompare(b.run_id),
  );
}

/**
 * Group every agent's findings into clusters: two findings share a cluster when
 * their `file` strings are EQUAL and their line ranges share at least one line.
 * That is the whole matching rule - the same one the eval harness applies - and
 * it is deliberately not semantic.
 *
 * Transitive by construction: a finding joins the first cluster it overlaps, and
 * that cluster's later members can extend its reach. Two findings on the same
 * line in different files are always different clusters, because file equality
 * is tested first (inside `overlaps`).
 */
export function clusterFindings(byAgent: AgentFindings[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const agent of byAgent) {
    for (const finding of agent.findings) {
      const hit = clusters.find(
        (c) => c.file === finding.file && c.members.some((m) => overlaps(m.finding, finding)),
      );
      if (hit) hit.members.push({ agent_id: agent.agent_id, finding });
      else clusters.push({ file: finding.file, members: [{ agent_id: agent.agent_id, finding }] });
    }
  }
  return clusters;
}

/**
 * The cluster's title and the line shown beside it: the highest-severity
 * finding, ties broken by highest confidence, then by the order the members
 * were added - which is the agent order, because `clusterFindings` walks the
 * agents in it.
 */
export function clusterTitle(cluster: Cluster): { title: string; line: number } {
  const best = cluster.members.reduce((a, b) =>
    pickHigher(a.finding, b.finding) === b.finding ? b : a,
  );
  return { title: best.finding.title, line: best.finding.start_line };
}

/**
 * What one agent says about one cluster.
 *
 * A severity plus that finding's own rationale when it flagged something there;
 * `did_not_flag` when its run SUCCEEDED and it did not; `no_opinion` when its
 * run failed or was cancelled and it never had the chance. The two silences are
 * different facts and the screen must be able to tell them apart.
 *
 * A silent stance carries NO prose: an agent that did not flag something wrote
 * nothing about it, and the only way to produce a sentence is a second model
 * pass over the other agents' findings - which is the one thing this design
 * refuses to do.
 */
export function stanceFor(agent: AgentFindings, cluster: Cluster): ConflictTake {
  const mine = cluster.members.filter((m) => m.agent_id === agent.agent_id).map((m) => m.finding);
  if (mine.length > 0) {
    // Several findings from one agent in one cluster: the most severe wins the cell.
    const best = mine.reduce((a, b) => pickHigher(a, b));
    return {
      agent_id: agent.agent_id,
      persona: agent.agent_name,
      verdict: best.severity,
      note: oneLine(best.rationale),
    };
  }
  return {
    agent_id: agent.agent_id,
    persona: agent.agent_name,
    verdict: agent.status === 'done' ? 'did_not_flag' : 'no_opinion',
    note: null,
  };
}

/**
 * Does this cluster belong in the disagreement section at all?
 *
 * True unless every agent whose run SUCCEEDED reports the same stance. An agent
 * whose run failed has no opinion and therefore cannot create a divergence -
 * otherwise every cluster of a run with one failed agent would look contested.
 */
export function isDivergent(takes: ConflictTake[]): boolean {
  const ran = takes.filter((t) => t.verdict !== 'no_opinion');
  if (ran.length === 0) return false;
  return ran.some((t) => t.verdict !== ran[0]!.verdict);
}

/**
 * Is this cluster a genuine CONFLICT - the show-only-conflicts filter?
 *
 * Only when two or more agents reported findings of DIFFERENT severities. One
 * agent flagging where the rest were silent is a divergence but not a conflict:
 * nobody contradicted it.
 */
export function isConflict(takes: ConflictTake[]): boolean {
  const flagged = takes.filter(
    (t) => t.verdict !== 'did_not_flag' && t.verdict !== 'no_opinion',
  );
  return flagged.length >= 2 && flagged.some((t) => t.verdict !== flagged[0]!.verdict);
}

/**
 * Assemble the disagreement section: one `Conflict` per divergent cluster, each
 * with one take per agent IN THE RUN - including agents that produced nothing
 * and agents whose run failed. A row with a missing column would silently read
 * as "that agent was not asked".
 */
export function conflictsFrom(byAgent: AgentFindings[]): Conflict[] {
  const out: Conflict[] = [];
  for (const cluster of clusterFindings(byAgent)) {
    const takes = byAgent.map((a) => stanceFor(a, cluster));
    if (!isDivergent(takes)) continue;
    const { title, line } = clusterTitle(cluster);
    out.push({ file: cluster.file, line, title, takes });
  }
  return out;
}

/**
 * A member run of a multi-agent run, in the only three fields the run-level
 * aggregates read.
 */
export interface MemberOutcome {
  status: AgentColumn['status'] | null;
  duration_ms: number | null;
  cost_usd: number | null;
}

/**
 * A multi-agent run's status, DERIVED from its member runs on every read.
 *
 * `running` while any member still is; `failed` only when every member failed;
 * `done` otherwise. Never stored: a stored status is a second source of truth
 * that can disagree with the rows it summarises after a reap.
 */
export function deriveStatus(members: MemberOutcome[]): 'running' | 'done' | 'failed' {
  if (members.length === 0) return 'done';
  if (members.some((m) => m.status === 'running')) return 'running';
  return members.every((m) => m.status === 'failed') ? 'failed' : 'done';
}

/**
 * A multi-agent run's duration: the LARGEST of its members', not their sum -
 * they ran in parallel, so the sum would report a wall-clock time that never
 * elapsed.
 */
export function totalDurationMs(members: MemberOutcome[]): number {
  return members.reduce((max, m) => Math.max(max, m.duration_ms ?? 0), 0);
}

/**
 * A multi-agent run's cost: the SUM of the KNOWN member costs, plus whether any
 * member's cost was unknown.
 *
 * An unpriced run is left OUT of the total rather than counted as zero, and the
 * partial flag is what stops the remainder reading as the whole bill. With no
 * known cost at all the total is null, which renders as "unpriced" rather than
 * as "$0.00".
 */
export function totalCost(members: MemberOutcome[]): {
  total_cost_usd: number | null;
  total_cost_partial: boolean;
} {
  const known = members.flatMap((m) => (m.cost_usd != null ? [m.cost_usd] : []));
  return {
    total_cost_usd: known.length > 0 ? known.reduce((a, b) => a + b, 0) : null,
    total_cost_partial: known.length < members.length,
  };
}

/** Median of a numeric set; null for an empty one. Even counts average the middle two. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * One agent's pre-run estimate from its own recent successful runs.
 *
 * Duration and cost are medianed INDEPENDENTLY, over the runs that recorded
 * each: a run whose provider reported no price still says something true about
 * how long the agent takes. `samples` counts the runs considered, so `0` is the
 * "no history" the configure screen leaves out of the estimate.
 */
export function estimateFor(
  agentId: string,
  runs: { duration_ms: number | null; cost_usd: number | null }[],
): { agent_id: string; median_duration_ms: number | null; median_cost_usd: number | null; samples: number } {
  return {
    agent_id: agentId,
    median_duration_ms: medianOf(runs.flatMap((r) => (r.duration_ms != null ? [r.duration_ms] : []))),
    median_cost_usd: medianOf(runs.flatMap((r) => (r.cost_usd != null ? [r.cost_usd] : []))),
    samples: runs.length,
  };
}

// ---------------------------------------------------------------------------

/** The more important of two findings: severity first, then confidence. */
function pickHigher(a: FindingRecord, b: FindingRecord): FindingRecord {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity < 0 ? a : b;
  // Equal severity: the more confident finding titles the cluster / wins the cell.
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
  // Fully tied: keep the earlier one, which is agent order.
  return a;
}

/**
 * A rationale is markdown and may be several paragraphs; a cluster cell has one
 * line. Take the first line and let the cell truncate the rest visually, rather
 * than cutting mid-word here.
 */
function oneLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
}
