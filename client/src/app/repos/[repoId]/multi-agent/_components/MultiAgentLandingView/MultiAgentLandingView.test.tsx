import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRunSummary } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/runs.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

let runs: MultiAgentRunSummary[] | undefined = [];
let state = { isLoading: false, isError: false };

vi.mock("@/lib/hooks/multi-agent", () => ({
  useRepoMultiAgentRuns: () => ({
    data: runs,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: vi.fn(),
  }),
}));

import { formatRunTime } from "@/lib/format";
import { MultiAgentLandingView } from "./MultiAgentLandingView";

afterEach(() => {
  cleanup();
  runs = [];
  state = { isLoading: false, isError: false };
  push.mockClear();
});

function run(over: Partial<MultiAgentRunSummary> = {}): MultiAgentRunSummary {
  return {
    id: "mar-1",
    pr_id: "pr-482",
    pr_number: 482,
    pr_title: "Add rate limiting to public API endpoints",
    ran_at: "2026-08-29T09:14:00.000Z",
    agent_count: 4,
    status: "done",
    total_duration_ms: 8200,
    total_cost_usd: 0.2,
    total_cost_partial: false,
    findings_count: 9,
    ...over,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">
        <MultiAgentLandingView repoId="r1" />
      </div>
    </NextIntlClientProvider>,
  );
}

describe("MultiAgentLandingView (amendment 01)", () => {
  it("lists the repository's runs and opens one into its results", () => {
    runs = [run(), run({ id: "mar-2", pr_number: 471, ran_at: "2026-08-28T09:14:00.000Z" })];
    renderView();

    const rows = screen.getAllByRole("button", { name: /Open the multi-agent run/ });
    expect(rows).toHaveLength(2);

    const first = within(rows[0]!);
    expect(first.getByText(/#482 · Add rate limiting/)).toBeInTheDocument();
    expect(first.getByText(/4 agents/)).toBeInTheDocument();
    expect(first.getByText("9 findings")).toBeInTheDocument();
    expect(first.getByText("8.2s")).toBeInTheDocument();
    expect(first.getByText("$0.2")).toBeInTheDocument();
    // Status is TEXT, not only colour.
    expect(first.getByText("done")).toBeInTheDocument();

    // Fix R1 step 6: the run's time carries no seconds.
    expect(first.getByText(new RegExp(formatRunTime("2026-08-29T09:14:00.000Z")))).toBeInTheDocument();
    expect(first.queryByText(/:\d\d:\d\d/)).not.toBeInTheDocument();

    fireEvent.click(rows[1]!);
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/mar-2");
  });

  it("describes the screen the reader is on, not the configure screen", () => {
    // Fix R1 step 4: the subtitle leaked from /new when amendment 01 split the
    // routes, and "pick a pull request" is an action this page cannot do.
    runs = [run()];
    renderView();

    expect(
      screen.getByText(/Every multi-agent review this repository has run/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pick a pull request/)).not.toBeInTheDocument();
  });

  it("carries no finding of any past run", () => {
    // The landing read is header-only on purpose: twenty past runs must not mean
    // twenty runs' worth of rationales over the wire.
    runs = [run()];
    const { container } = renderView();
    expect(container.textContent).not.toContain("rationale");
    expect(screen.queryByText(/did not flag/)).not.toBeInTheDocument();
  });

  it("marks a partial total rather than reporting it as the whole bill", () => {
    runs = [run({ total_cost_usd: 0.12, total_cost_partial: true })];
    renderView();
    expect(screen.getByText("at least $0.12")).toBeInTheDocument();
  });

  it("shows a running run as running, and still navigates to it", () => {
    runs = [run({ status: "running", total_duration_ms: null })];
    renderView();

    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("not finished")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open the multi-agent run/ }));
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/mar-1");
  });

  it("offers the start control with an empty state rather than redirecting anywhere", () => {
    runs = [];
    renderView();

    expect(screen.getByText("No multi-agent review yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open the multi-agent run/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New multi-agent review" }));
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/new");
  });

  it("keeps the start control available while the list is loading or failed", () => {
    state = { isLoading: false, isError: true };
    runs = undefined;
    renderView();

    expect(screen.getByText("Could not load this repository's multi-agent runs.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New multi-agent review" })).toBeInTheDocument();
  });
});
