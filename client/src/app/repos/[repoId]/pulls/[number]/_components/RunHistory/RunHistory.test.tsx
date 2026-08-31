/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

// FindingsPopover (rendered on severity-badge hover) fetches the PR's reviews.
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({
    data: [
      {
        id: "rev-1",
        pr_id: "pr-1",
        agent_id: "a1",
        run_id: "run-1",
        agent_name: "Security Reviewer",
        kind: "review",
        verdict: "request_changes",
        summary: null,
        score: 40,
        model: "deepseek/deepseek-v4-flash",
        grounding: "1/1 passed",
        created_at: "2026-06-11T18:44:34.000Z",
        findings: [
          {
            id: "f1",
            title: "Hardcoded Stripe secret key in commit",
            severity: "CRITICAL",
            category: "security",
            file: "src/config.ts",
            start_line: 12,
            end_line: 12,
            confidence: 0.98,
            rationale: "Live key committed in plaintext.",
          },
        ],
      },
    ],
  }),
}));

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    multi_agent_run_id: null,
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.0013,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], prId?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} prId={prId} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — severity breakdown", () => {
  it("a settled run with severity counts shows compact badges instead of the findings text", () => {
    renderRuns([
      run({
        findings_count: 3,
        blockers: 2,
        score: 40,
        severity_counts: { critical: 2, warning: 1, suggestion: 0 },
      }),
    ]);
    expect(screen.getByText("2")).toBeInTheDocument(); // CRITICAL badge count
    expect(screen.getByText("1")).toBeInTheDocument(); // WARNING badge count
    expect(screen.queryByText(/finding\(s\)/)).not.toBeInTheDocument();
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
  });

  it("a run without severity counts falls back to the findings text", () => {
    renderRuns([run({ findings_count: 3, blockers: 0, score: 72, severity_counts: null })]);
    expect(screen.getByText("3 finding(s)")).toBeInTheDocument();
  });
});

describe("RunHistory — findings hover popover", () => {
  const withFindings = () =>
    run({
      findings_count: 1,
      blockers: 1,
      score: 40,
      severity_counts: { critical: 1, warning: 0, suggestion: 0 },
    });

  it("hovering a run's severity badges shows that run's findings card", () => {
    renderRuns([withFindings()], "pr-1");
    expect(screen.queryByText("Hardcoded Stripe secret key in commit")).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByTestId("run-severities:run-1"));
    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByTestId("run-severities:run-1"));
    expect(screen.queryByText("Hardcoded Stripe secret key in commit")).not.toBeInTheDocument();
  });

  it("no popover without a prId (list-only data)", () => {
    renderRuns([withFindings()]);
    fireEvent.mouseEnter(screen.getByTestId("run-severities:run-1"));
    expect(screen.queryByText("Hardcoded Stripe secret key in commit")).not.toBeInTheDocument();
  });
});

describe("RunHistory — run cost (L01)", () => {
  it("a settled run shows tokens · cost", () => {
    renderRuns([run({ status: "done", tokens_in: 9000, tokens_out: 119, cost_usd: 0.0013 })]);
    expect(screen.getByText("9,119 tok · $0.0013")).toBeInTheDocument();
  });

  it("unknown cost renders — (never $0.00)", () => {
    renderRuns([run({ status: "done", cost_usd: null })]);
    expect(screen.getByText("150 tok · —")).toBeInTheDocument();
  });

  it("a running run shows no cost line", () => {
    renderRuns([run({ status: "running", cost_usd: null, score: null, blockers: null })]);
    expect(screen.queryByText(/tok ·/)).not.toBeInTheDocument();
  });
});

/**
 * L07 - a fan-out lands N rows at one timestamp. AC-27 says they must read as
 * ONE action, and AC-28 says opening that entry goes to the comparison.
 */
describe("RunHistory - a multi-agent run is one entry", () => {
  const openMulti = vi.fn();

  function renderWithMulti(runs: RunSummary[]) {
    return render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunHistory runs={runs} onOpenTrace={() => {}} onOpenMultiAgentRun={openMulti} />
      </NextIntlClientProvider>,
    );
  }

  afterEach(() => openMulti.mockClear());

  it("groups the runs sharing a multi-agent run and labels it with the agent count", () => {
    renderWithMulti([
      run({ run_id: "r1", multi_agent_run_id: "mar-1", agent_name: "Security", findings_count: 3 }),
      run({ run_id: "r2", multi_agent_run_id: "mar-1", agent_name: "Performance", findings_count: 2 }),
      run({ run_id: "r3", multi_agent_run_id: "mar-1", agent_name: "Junior Mentor", findings_count: 1 }),
      // A single-agent run beside it still renders as its own row, unchanged.
      run({ run_id: "r4", agent_name: "Solo Reviewer" }),
    ]);

    expect(screen.getByText("3 agents in parallel")).toBeInTheDocument();
    expect(screen.getByText("6 finding(s)")).toBeInTheDocument();
    // The members are folded INTO the group, not listed beside it.
    expect(screen.queryByText("Security")).not.toBeInTheDocument();
    expect(screen.queryByText("Performance")).not.toBeInTheDocument();
    // The single-agent row is untouched.
    expect(screen.getByText("Solo Reviewer")).toBeInTheDocument();
  });

  it("opens that multi-agent run's results", () => {
    renderWithMulti([
      run({ run_id: "r1", multi_agent_run_id: "mar-9" }),
      run({ run_id: "r2", multi_agent_run_id: "mar-9" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Open this multi-agent review" }));
    expect(openMulti).toHaveBeenCalledWith("mar-9");
  });

  it("keeps two different multi-agent runs apart", () => {
    renderWithMulti([
      run({ run_id: "r1", multi_agent_run_id: "mar-1", ran_at: "2026-06-11T18:44:34.000Z" }),
      run({ run_id: "r2", multi_agent_run_id: "mar-1", ran_at: "2026-06-11T18:44:34.000Z" }),
      run({ run_id: "r3", multi_agent_run_id: "mar-2", ran_at: "2026-06-12T18:44:34.000Z" }),
      run({ run_id: "r4", multi_agent_run_id: "mar-2", ran_at: "2026-06-12T18:44:34.000Z" }),
    ]);

    expect(screen.getAllByText("2 agents in parallel")).toHaveLength(2);
  });
});
