import { describe, it, expect } from 'vitest';
import type { FindingRecord, Severity } from '@devdigest/shared';
import {
  byAgentOrder,
  clusterFindings,
  clusterTitle,
  conflictsFrom,
  estimateFor,
  isConflict,
  isDivergent,
  medianOf,
  stanceFor,
  type AgentFindings,
} from './multi-agent.js';

/**
 * L07 - the comparison rules, hermetically. Everything here is a comparison of
 * a file string and two line numbers, which is exactly why it can be tested
 * without a database, a container or a model.
 */

let seq = 0;
function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  seq += 1;
  return {
    id: `f${seq}`,
    review_id: 'rv1',
    severity: 'WARNING',
    category: 'bug',
    title: `finding ${seq}`,
    file: 'src/middleware/ratelimit.ts',
    start_line: 28,
    end_line: 30,
    rationale: 'Because of the thing.',
    suggestion: null,
    confidence: 0.8,
    kind: null,
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function agent(over: Partial<AgentFindings> = {}): AgentFindings {
  return {
    agent_id: 'a1',
    agent_name: 'Security',
    status: 'done',
    findings: [],
    ...over,
  };
}

describe('clusterFindings', () => {
  it('puts two overlapping ranges on the same file in one cluster', () => {
    // AC-41, the criterion's own example.
    const a = agent({ agent_id: 'a1', findings: [finding({ start_line: 28, end_line: 30 })] });
    const b = agent({ agent_id: 'a2', findings: [finding({ start_line: 29, end_line: 31 })] });

    const clusters = clusterFindings([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.members.map((m) => m.agent_id)).toEqual(['a1', 'a2']);
  });

  it('keeps two ranges that share no line apart', () => {
    const a = agent({ agent_id: 'a1', findings: [finding({ start_line: 28, end_line: 30 })] });
    const b = agent({ agent_id: 'a2', findings: [finding({ start_line: 31, end_line: 33 })] });

    expect(clusterFindings([a, b])).toHaveLength(2);
  });

  it('reads a reversed range as the interval between its two numbers', () => {
    // Nothing stops a model from emitting start_line above end_line, and the
    // eval scorer normalises the same way.
    const a = agent({ agent_id: 'a1', findings: [finding({ start_line: 30, end_line: 28 })] });
    const b = agent({ agent_id: 'a2', findings: [finding({ start_line: 29, end_line: 29 })] });

    expect(clusterFindings([a, b])).toHaveLength(1);
  });

  it('keeps the same line in two different files apart', () => {
    // File equality is required FIRST (AC-41).
    const a = agent({ agent_id: 'a1', findings: [finding({ file: 'src/a.ts', start_line: 12, end_line: 12 })] });
    const b = agent({ agent_id: 'a2', findings: [finding({ file: 'src/b.ts', start_line: 12, end_line: 12 })] });

    expect(clusterFindings([a, b])).toHaveLength(2);
  });

  it('joins a chain of findings that overlap transitively', () => {
    const a = agent({ agent_id: 'a1', findings: [finding({ start_line: 10, end_line: 20 })] });
    const b = agent({ agent_id: 'a2', findings: [finding({ start_line: 20, end_line: 30 })] });
    const c = agent({ agent_id: 'a3', findings: [finding({ start_line: 30, end_line: 40 })] });

    const clusters = clusterFindings([a, b, c]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.members).toHaveLength(3);
  });
});

describe('clusterTitle', () => {
  it('titles a cluster with its highest-severity finding', () => {
    // AC-43: one CRITICAL and one SUGGESTION.
    const a = agent({
      agent_id: 'a1',
      findings: [finding({ severity: 'SUGGESTION', title: 'Extract magic number' })],
    });
    const b = agent({
      agent_id: 'a2',
      findings: [finding({ severity: 'CRITICAL', title: 'Hardcoded secret', start_line: 29, end_line: 29 })],
    });

    const [cluster] = clusterFindings([a, b]);
    expect(clusterTitle(cluster!).title).toBe('Hardcoded secret');
  });

  it('breaks a severity tie by highest confidence', () => {
    const a = agent({
      agent_id: 'a1',
      findings: [finding({ severity: 'WARNING', title: 'less sure', confidence: 0.5 })],
    });
    const b = agent({
      agent_id: 'a2',
      findings: [finding({ severity: 'WARNING', title: 'more sure', confidence: 0.9, start_line: 29 })],
    });

    const [cluster] = clusterFindings([a, b]);
    expect(clusterTitle(cluster!).title).toBe('more sure');
  });

  it('breaks a full tie by the order of the agents in the run', () => {
    const a = agent({ agent_id: 'a1', findings: [finding({ title: 'first agent' })] });
    const b = agent({ agent_id: 'a2', findings: [finding({ title: 'second agent', start_line: 29 })] });

    const [cluster] = clusterFindings([a, b]);
    expect(clusterTitle(cluster!).title).toBe('first agent');
  });

  it('labels the cluster with the START LINE of the finding that titled it', () => {
    // AC-44: the file:line label comes from the titling finding, not the cluster's span.
    const a = agent({
      agent_id: 'a1',
      findings: [finding({ severity: 'SUGGESTION', start_line: 28, end_line: 34 })],
    });
    const b = agent({
      agent_id: 'a2',
      findings: [finding({ severity: 'CRITICAL', start_line: 31, end_line: 31 })],
    });

    const [cluster] = clusterFindings([a, b]);
    expect(clusterTitle(cluster!).line).toBe(31);
  });
});

describe('stanceFor', () => {
  it('gives a flagging agent its severity and its own rationale, one line', () => {
    // AC-50.
    const a = agent({
      agent_id: 'a1',
      agent_name: 'Customer-Facing',
      findings: [
        finding({ severity: 'WARNING', rationale: 'Needs machine-readable code.\n\nAnd a Retry-After.' }),
      ],
    });

    const [cluster] = clusterFindings([a]);
    expect(stanceFor(a, cluster!)).toEqual({
      agent_id: 'a1',
      persona: 'Customer-Facing',
      verdict: 'WARNING',
      note: 'Needs machine-readable code.',
    });
  });

  it('shows an agent with several findings in one cluster its most severe one', () => {
    // AC-51.
    const a = agent({
      agent_id: 'a1',
      findings: [
        finding({ severity: 'SUGGESTION', rationale: 'nit' }),
        finding({ severity: 'WARNING', rationale: 'real problem', start_line: 29 }),
      ],
    });

    const [cluster] = clusterFindings([a]);
    const take = stanceFor(a, cluster!);
    expect(take.verdict).toBe('WARNING');
    expect(take.note).toBe('real problem');
  });

  it('reads a successful silent agent as did_not_flag, with no prose', () => {
    // AC-48: "did not flag" and no further text.
    const flagged = agent({ agent_id: 'a1', findings: [finding({})] });
    const silent = agent({ agent_id: 'a2', agent_name: 'Performance', status: 'done' });

    const [cluster] = clusterFindings([flagged, silent]);
    expect(stanceFor(silent, cluster!)).toEqual({
      agent_id: 'a2',
      persona: 'Performance',
      verdict: 'did_not_flag',
      note: null,
    });
  });

  it('reads a failed or cancelled agent as no_opinion, distinct from silence', () => {
    // AC-49.
    const flagged = agent({ agent_id: 'a1', findings: [finding({})] });
    const failed = agent({ agent_id: 'a2', status: 'failed' });
    const cancelled = agent({ agent_id: 'a3', status: 'cancelled' });

    const [cluster] = clusterFindings([flagged, failed, cancelled]);
    expect(stanceFor(failed, cluster!).verdict).toBe('no_opinion');
    expect(stanceFor(cancelled, cluster!).verdict).toBe('no_opinion');
  });
});

describe('isDivergent / isConflict', () => {
  const take = (verdict: Severity | 'did_not_flag' | 'no_opinion', id = 'a') => ({
    agent_id: id,
    persona: id,
    verdict,
    note: null,
  });

  it('hides a cluster every successful agent flagged identically', () => {
    // AC-46.
    expect(isDivergent([take('WARNING', 'a1'), take('WARNING', 'a2')])).toBe(false);
  });

  it('shows a cluster one agent flagged and the rest were silent on', () => {
    expect(isDivergent([take('WARNING', 'a1'), take('did_not_flag', 'a2')])).toBe(true);
  });

  it('lets a failed agent create no divergence of its own', () => {
    expect(isDivergent([take('WARNING', 'a1'), take('no_opinion', 'a2')])).toBe(false);
  });

  it('counts only differing severities as a conflict', () => {
    // AC-47: one flagged, the rest silent, is a divergence but NOT a conflict.
    expect(isConflict([take('WARNING', 'a1'), take('did_not_flag', 'a2')])).toBe(false);
    // Two agents at the SAME severity plus a silent third is also not a conflict.
    expect(
      isConflict([take('CRITICAL', 'a1'), take('CRITICAL', 'a2'), take('did_not_flag', 'a3')]),
    ).toBe(false);
    // Two agents at DIFFERENT severities is.
    expect(isConflict([take('CRITICAL', 'a1'), take('SUGGESTION', 'a2')])).toBe(true);
  });
});

describe('conflictsFrom', () => {
  it('gives every agent in the run a column in every row, failed ones included', () => {
    // AC-45.
    const a = agent({ agent_id: 'a1', agent_name: 'Junior Mentor', findings: [finding({ severity: 'SUGGESTION' })] });
    const b = agent({ agent_id: 'a2', agent_name: 'Security' });
    const c = agent({ agent_id: 'a3', agent_name: 'Architecture', status: 'failed' });

    const conflicts = conflictsFrom([a, b, c]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.takes.map((t) => t.agent_id)).toEqual(['a1', 'a2', 'a3']);
    expect(conflicts[0]!.takes.map((t) => t.verdict)).toEqual([
      'SUGGESTION',
      'did_not_flag',
      'no_opinion',
    ]);
  });

  it('produces no rows when every agent produced identical findings', () => {
    // AC-52: the section states the agents agreed rather than rendering an empty table.
    const a = agent({ agent_id: 'a1', findings: [finding({ severity: 'WARNING' })] });
    const b = agent({ agent_id: 'a2', findings: [finding({ severity: 'WARNING', start_line: 29 })] });

    expect(conflictsFrom([a, b])).toEqual([]);
  });
});

describe('byAgentOrder', () => {
  it('orders by agent name, then by run id for a deleted agent', () => {
    const rows = [
      { agent_name: 'Security', run_id: 'r2' },
      { agent_name: 'Architecture', run_id: 'r9' },
      { agent_name: 'Security', run_id: 'r1' },
    ];
    expect(byAgentOrder(rows).map((r) => r.run_id)).toEqual(['r9', 'r1', 'r2']);
  });
});

describe('medianOf / estimateFor', () => {
  it('medians an odd and an even set', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
    expect(medianOf([])).toBeNull();
  });

  it('medians duration and cost independently of each other', () => {
    // A run whose provider reported no price still says something true about
    // how long the agent takes.
    expect(
      estimateFor('a1', [
        { duration_ms: 8000, cost_usd: 0.06 },
        { duration_ms: 6000, cost_usd: null },
        { duration_ms: 10000, cost_usd: 0.04 },
      ]),
    ).toEqual({
      agent_id: 'a1',
      median_duration_ms: 8000,
      median_cost_usd: 0.05,
      samples: 3,
    });
  });

  it('reports an agent that has never succeeded as zero samples and no numbers', () => {
    // AC-13/AC-14: the configure screen leaves it out and marks the estimate partial.
    expect(estimateFor('a1', [])).toEqual({
      agent_id: 'a1',
      median_duration_ms: null,
      median_cost_usd: null,
      samples: 0,
    });
  });
});
