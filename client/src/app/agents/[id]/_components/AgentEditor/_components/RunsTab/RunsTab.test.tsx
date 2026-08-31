import { describe, it, expect, afterEach, vi } from "vitest";
// `@testing-library/user-event` is not a dependency of this package; the rest
// of the suite drives clicks with fireEvent, so this does too.
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentRunSummary, AgentRunsPage } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json";

/** What the mocked hook returns; each test assigns to these. */
let pages: AgentRunsPage[] = [];
let state = { isLoading: false, isError: false, hasNextPage: false };
const fetchNextPage = vi.fn();

vi.mock("@/lib/hooks/runs", () => ({
  useAgentRuns: () => ({
    data: { pages, pageParams: [] },
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: vi.fn(),
    fetchNextPage,
    hasNextPage: state.hasNextPage,
    isFetchingNextPage: false,
  }),
}));

/** The drawer is exercised by its own suite; here it only has to prove that a
    row opened it, and for which run. */
vi.mock("@/components/run-trace-drawer", () => ({
  default: ({ runId, running }: { runId: string; running?: boolean }) => (
    <div data-testid="trace-drawer" data-run-id={runId} data-running={String(!!running)} />
  ),
}));

import { formatRunTime } from "@/lib/format";
import { RunsTab } from "./RunsTab";

afterEach(() => {
  cleanup();
  pages = [];
  state = { isLoading: false, isError: false, hasNextPage: false };
  fetchNextPage.mockClear();
});

const AGENT = { id: "a1", name: "Security Reviewer" } as Agent;

function run(over: Partial<AgentRunSummary>): AgentRunSummary {
  return {
    run_id: "r1",
    ran_at: "2026-08-29T09:14:00.000Z",
    pr_id: "p1",
    pr_number: 482,
    pr_title: "Add rate limiting to public API endpoints",
    status: "done",
    error: null,
    findings_count: 3,
    blockers: 1,
    score: 72,
    duration_ms: 8200,
    cost_usd: 0.06,
    source: "local",
    ...over,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">
        <RunsTab agent={AGENT} />
      </div>
    </NextIntlClientProvider>,
  );
}

describe("RunsTab (L07 companion)", () => {
  it("lists the agent's runs with their outcome and opens one into the trace drawer", () => {
    pages = [
      {
        runs: [
          run({}),
          run({ run_id: "r2", ran_at: "2026-08-28T09:14:00.000Z", pr_number: 471, score: 90 }),
        ],
        has_more: false,
      },
    ];
    renderTab();

    const rows = screen.getAllByRole("button", { name: /Open the trace of the run/ });
    expect(rows).toHaveLength(2);

    // AC-6: the row carries the pull request, findings, score, duration and cost.
    // Scoped to the row, because every field legitimately repeats across rows.
    const first = within(rows[0]!);
    expect(first.getByText(/#482 · Add rate limiting/)).toBeInTheDocument();
    expect(first.getByText("3 findings")).toBeInTheDocument();
    expect(first.getByText("score 72")).toBeInTheDocument();
    expect(first.getByText("8.2s")).toBeInTheDocument();
    expect(first.getByText("$0.06")).toBeInTheDocument();
    // AC-6: status and source are TEXT, not only colour.
    expect(first.getByText("done")).toBeInTheDocument();
    expect(first.getByText("studio")).toBeInTheDocument();

    // Fix R1 step 6: the row's time carries no seconds.
    expect(first.getByText(formatRunTime("2026-08-29T09:14:00.000Z"))).toBeInTheDocument();
    expect(first.queryByText(/:\d\d:\d\d/)).not.toBeInTheDocument();

    // AC-18: no trace is requested until a row is opened.
    expect(screen.queryByTestId("trace-drawer")).not.toBeInTheDocument();

    // AC-10: activating a row opens THAT run's drawer.
    fireEvent.click(rows[1]!);
    expect(screen.getByTestId("trace-drawer")).toHaveAttribute("data-run-id", "r2");
  });

  it("shows a failed run's error, a run with no pull request, and a running run's live log", () => {
    pages = [
      {
        runs: [
          run({
            run_id: "r-fail",
            status: "failed",
            error: "openai: 401 invalid api key",
            score: null,
            duration_ms: null,
            cost_usd: null,
          }),
          run({ run_id: "r-nopr", ran_at: "2026-08-28T09:14:00.000Z", pr_id: null, pr_number: null, pr_title: null }),
          run({ run_id: "r-live", ran_at: "2026-08-27T09:14:00.000Z", status: "running", score: null }),
        ],
        has_more: false,
      },
    ];
    renderTab();

    // AC-7: the reason is on the row, no drawer needed.
    expect(screen.getByText("openai: 401 invalid api key")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    // AC-8: the row survives its pull request being deleted.
    expect(screen.getByText("No pull request")).toBeInTheDocument();

    // AC-13: an in-flight run opens on the live log, not on a pending trace.
    const rows = screen.getAllByRole("button", { name: /Open the trace of the run/ });
    fireEvent.click(rows[2]!);
    expect(screen.getByTestId("trace-drawer")).toHaveAttribute("data-running", "true");
  });

  it("states that the agent has not run yet instead of rendering an empty list", () => {
    pages = [{ runs: [], has_more: false }];
    renderTab();

    // AC-9.
    expect(screen.getByText("This agent has not run yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open the trace of the run/ })).not.toBeInTheDocument();
  });

  it("offers a load-more control only while the server reports another page", () => {
    pages = [{ runs: [run({})], has_more: true }];
    state = { ...state, hasNextPage: true };
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
