import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, Conflict, FindingRecord, MultiAgentRun } from "@devdigest/shared";
import runsMessages from "../../../../../../../../messages/en/runs.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

let run: MultiAgentRun | undefined;
const findingAction = vi.fn();

vi.mock("@/lib/hooks/multi-agent", () => ({
  useMultiAgentRun: () => ({ data: run, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: findingAction, isPending: false }),
}));
vi.mock("@/lib/hooks", () => ({
  usePullDetail: () => ({ data: { files: [] } }),
}));
vi.mock("@/components/run-trace-drawer", () => ({
  default: ({ runId }: { runId: string }) => <div data-testid="trace-drawer" data-run-id={runId} />,
}));
vi.mock("@/components/eval-case-modal", () => ({
  EvalCaseModal: () => <div data-testid="eval-case-modal" />,
}));

import { MultiAgentResultsView } from "./MultiAgentResultsView";
import { VIEW_STORAGE_KEY, agentColor } from "./constants";

/** jsdom computes no layout, so every measured box is 0 unless it is stubbed. */
function stubBox(prop: "clientWidth" | "clientHeight" | "scrollHeight", value: number) {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, prop, original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  };
}

let seq = 0;
function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  seq += 1;
  return {
    id: `f${seq}`,
    review_id: "rv1",
    severity: "WARNING",
    category: "bug",
    title: `Finding ${seq}`,
    file: "src/middleware/ratelimit.ts",
    start_line: 28,
    end_line: 30,
    rationale: "Because of the thing.",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function column(over: Partial<AgentColumn>): AgentColumn {
  return {
    run_id: "r1",
    agent_id: "a1",
    agent_name: "Security",
    provider: "openai",
    model: "gpt-4.1",
    status: "done",
    error: null,
    verdict: "request_changes",
    score: 38,
    summary: "Two critical exposures.",
    duration_ms: 8200,
    cost_usd: 0.06,
    findings: [],
    ...over,
  };
}

function multiRun(over: Partial<MultiAgentRun> = {}): MultiAgentRun {
  return {
    id: "mar-1",
    pr_id: "pr-482",
    pr_number: 482,
    pr_title: "Add rate limiting to public API endpoints",
    ran_at: "2026-08-29T09:14:00.000Z",
    agent_count: 2,
    status: "done",
    total_duration_ms: 8200,
    total_cost_usd: 0.2,
    total_cost_partial: false,
    columns: [],
    conflicts: [],
    ...over,
  };
}

function conflict(takes: Conflict["takes"], over: Partial<Conflict> = {}): Conflict {
  return {
    file: "src/middleware/ratelimit.ts",
    line: 28,
    title: "Magic number 3600",
    takes,
    ...over,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ runs: runsMessages, prReview: prReviewMessages }}
    >
      <div data-theme="dark">
        <MultiAgentResultsView repoId="r1" runId="mar-1" />
      </div>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  // jsdom has no matchMedia; without it the narrow-viewport check throws.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  run = undefined;
  findingAction.mockClear();
  push.mockClear();
});

describe("MultiAgentResultsView - the header", () => {
  it("states the agent count, that they ran in parallel, the duration and the cost", () => {
    run = multiRun({ agent_count: 4, total_duration_ms: 8200, total_cost_usd: 0.2 });
    renderView();

    // AC-32. And explicitly NOT the mockup's "fan-out via worktrees": every
    // agent read the same diff, nothing was checked out per agent.
    expect(screen.getByText("4 agents · parallel · 8.2s · $0.2")).toBeInTheDocument();
    expect(screen.queryByText(/worktree/i)).not.toBeInTheDocument();
    expect(screen.getByText(/#482 Add rate limiting/)).toBeInTheDocument();
  });

  it("marks the total partial when an agent's cost is unknown", () => {
    // AC-26: the remainder must not read as the whole bill.
    run = multiRun({ total_cost_usd: 0.12, total_cost_partial: true });
    renderView();
    expect(screen.getByText(/at least \$0\.12/)).toBeInTheDocument();
  });
});

describe("MultiAgentResultsView - columns and tabs", () => {
  const TWO = [
    column({ run_id: "r1", agent_name: "Security", findings: [finding({ severity: "CRITICAL", title: "Hardcoded key", file: "src/config.ts", start_line: 12 })] }),
    column({ run_id: "r2", agent_id: "a2", agent_name: "Performance", score: 64, summary: "N+1 in the user list.", findings: [finding({})] }),
  ];

  it("shows each agent's name, duration, cost, score, findings and a trace control", () => {
    run = multiRun({ columns: TWO });
    renderView();

    // AC-33 in the columns view.
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText(/8\.2s · \$0\.06 · score 38/)).toBeInTheDocument();
    expect(screen.getByText("Hardcoded key")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    // Severity is carried by TEXT, not only by the colour bar.
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getAllByText("1 finding")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "View the trace of Security's run" }));
    expect(screen.getByTestId("trace-drawer")).toHaveAttribute("data-run-id", "r1");
  });

  it("offers both views, remembers the choice, and reads it back on the next open", () => {
    run = multiRun({ columns: TWO });
    const { unmount } = renderView();

    // AC-30.
    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe("tabs");

    // AC-31: a reload of the same browser comes back on the same view.
    unmount();
    renderView();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("shows the persisted review summary verbatim and exactly three finding actions", () => {
    run = multiRun({ columns: TWO });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));

    // AC-35: the summary, unmodified.
    expect(screen.getByText("Two critical exposures.")).toBeInTheDocument();

    // AC-37: Accept, Dismiss and Turn into eval case, and nothing else. No
    // Learn, no Reply to author - both are later lessons.
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn into eval case" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Learn/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reply to author/ })).not.toBeInTheDocument();

    // AC-38: accepting writes the same record the PR page writes.
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(findingAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "accept", prId: "pr-482" }),
    );
  });

  it("shows a failed agent's error in place of a score and a findings list", () => {
    // AC-39.
    run = multiRun({
      columns: [
        column({ run_id: "r1", agent_name: "Security", findings: [finding({})] }),
        column({
          run_id: "r2",
          agent_id: "a2",
          agent_name: "Architecture",
          status: "failed",
          error: "openai: 401 invalid api key",
          score: null,
          findings: [],
        }),
      ],
    });
    renderView();

    expect(screen.getByText("openai: 401 invalid api key")).toBeInTheDocument();
    expect(screen.getByText("This agent's run failed.")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("shows a running agent as running, not as having found nothing", () => {
    // AC-40.
    run = multiRun({
      columns: [column({ run_id: "r1", status: "running", score: null, findings: [] })],
    });
    renderView();

    expect(screen.getByText("still running…")).toBeInTheDocument();
    expect(screen.queryByText("No findings.")).not.toBeInTheDocument();
  });
});

describe("MultiAgentResultsView - the score ring and the agents' colours", () => {
  const TWO = [
    column({ run_id: "r1", agent_name: "Security", score: 38 }),
    column({ run_id: "r2", agent_id: "a2", agent_name: "Performance", score: 64 }),
  ];

  it("draws the same ring the pull request page draws, and none for a missing score", () => {
    // Fix R1 step 1. The ring is the glanceable copy; the number stays as text,
    // which is what AC-33 is read from and what a screen reader gets.
    run = multiRun({
      columns: [TWO[0]!, column({ run_id: "r2", agent_id: "a2", agent_name: "Architecture", score: null })],
    });
    renderView();

    expect(screen.getAllByTestId("score-ring")).toHaveLength(1);
    expect(screen.getByText(/score 38/)).toBeInTheDocument();
    expect(screen.getByText(/· no score$/)).toBeInTheDocument();
  });

  it("carries the ring into the tabs summary card too", () => {
    run = multiRun({ columns: TWO });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));

    // One card, one ring - the columns are gone in this view.
    expect(screen.getAllByTestId("score-ring")).toHaveLength(1);
    expect(screen.getByText(/score 38/)).toBeInTheDocument();
  });

  it("gives each agent its own colour, by index in the run's stable order", () => {
    // Fix R1 step 2: five identical grey columns are unreadable at a glance.
    run = multiRun({
      columns: [
        TWO[0]!,
        TWO[1]!,
        column({ run_id: "r3", agent_id: "a3", agent_name: "Junior Mentor", score: 72 }),
      ],
    });
    renderView();

    const accents = screen.getAllByTestId("agent-accent");
    accents.forEach((el, i) => expect(el).toHaveStyle({ background: agentColor(i) }));
    // Three agents, three distinguishable colours - not one accent repeated.
    expect(new Set(accents.map((el) => el.style.background)).size).toBe(3);

    // Colour is never the only carrier: the names are still text.
    for (const name of ["Security", "Performance", "Junior Mentor"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});

describe("MultiAgentResultsView - the columns fallback", () => {
  const columnsOf = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      column({ run_id: `r${i}`, agent_id: `a${i}`, agent_name: `Agent ${i}` }),
    );

  // The measured defect: scrollWidth 1548 against clientWidth 1278 at a 1600px
  // viewport, so 270px of the fifth column sat behind a horizontal scrollbar.
  const AVAILABLE = 1278;

  it("falls back to tabs on agent COUNT, not only on viewport width", () => {
    const restore = stubBox("clientWidth", AVAILABLE);
    try {
      run = multiRun({ columns: columnsOf(5), agent_count: 5 });
      renderView();

      // Five columns need 5 x 300 + 4 x 12 = 1548 > 1278, so tabs win even
      // though the window is wide.
      expect(screen.getAllByRole("tab")).toHaveLength(5);
      expect(screen.queryAllByTestId("agent-accent")).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("keeps the columns view when every column still fits the same width", () => {
    const restore = stubBox("clientWidth", AVAILABLE);
    try {
      run = multiRun({ columns: columnsOf(3), agent_count: 3 });
      renderView();

      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      expect(screen.getAllByTestId("agent-accent")).toHaveLength(3);
    } finally {
      restore();
    }
  });
});

describe("MultiAgentResultsView - the tabs summary", () => {
  const LONG =
    "Two critical exposures: a committed live key and an SSRF-shaped webhook forwarder. " +
    "The key is a live Stripe secret, so it must be rotated as well as removed. " +
    "The forwarder takes an untrusted URL and fetches it from inside the VPC. " +
    "Both are blocking; nothing else in the diff changes the risk picture. " +
    "The rate limiter itself is sound. Block until both are fixed.";

  it("clamps a paragraph to two lines with a working expand, and keeps every word in the DOM", () => {
    // Fix R1 step 5. AC-35 wants the persisted summary VERBATIM, so the clamp
    // is CSS only - nothing is cut in JavaScript.
    const restoreScroll = stubBox("scrollHeight", 96);
    const restoreClient = stubBox("clientHeight", 40);
    try {
      run = multiRun({ columns: [column({ summary: LONG })] });
      renderView();
      fireEvent.click(screen.getByRole("button", { name: "Tabs" }));

      const summary = screen.getByText(LONG);
      expect(summary).toBeInTheDocument();
      expect(summary.style.webkitLineClamp).toBe("2");

      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      expect(screen.getByText(LONG).style.webkitLineClamp).toBe("");
      expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
    } finally {
      restoreClient();
      restoreScroll();
    }
  });

  it("offers no expand control for a summary that fits", () => {
    run = multiRun({ columns: [column({ summary: "Two critical exposures." })] });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));

    expect(screen.getByText("Two critical exposures.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });
});

describe("MultiAgentResultsView - where agents disagree", () => {
  const THREE_TAKES: Conflict["takes"] = [
    { agent_id: "a1", persona: "Junior Mentor", verdict: "SUGGESTION", note: "Extract for readability." },
    { agent_id: "a2", persona: "Security", verdict: "did_not_flag", note: null },
    { agent_id: "a3", persona: "Architecture", verdict: "no_opinion", note: null },
  ];

  it("gives every agent a column in every row, and distinguishes silence from no opinion", () => {
    run = multiRun({ conflicts: [conflict(THREE_TAKES)] });
    renderView();

    // AC-44 and AC-45.
    expect(screen.getByText("src/middleware/ratelimit.ts:28")).toBeInTheDocument();
    expect(screen.getByText("Magic number 3600")).toBeInTheDocument();
    for (const name of ["Junior Mentor", "Security", "Architecture"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    // AC-50: severity plus that finding's OWN rationale.
    expect(screen.getByText("SUGGESTION")).toBeInTheDocument();
    expect(screen.getByText("Extract for readability.")).toBeInTheDocument();

    // AC-48: "did not flag" and NOTHING else - no invented explanation.
    expect(screen.getByText("did not flag")).toBeInTheDocument();
    expect(screen.queryByText(/Not a security concern/)).not.toBeInTheDocument();
    expect(screen.queryByText(/out of scope for arch review/)).not.toBeInTheDocument();

    // AC-49: a failed agent's cell is visibly DISTINCT from a silent one.
    expect(screen.getByText("no opinion (run failed)")).toBeInTheDocument();
  });

  it("hides a divergence that no two agents contradict while the conflicts filter is on", () => {
    // AC-47: one flagged, the rest silent, is a divergence but not a conflict.
    const oneFlagged = conflict(
      [
        { agent_id: "a1", persona: "Junior Mentor", verdict: "SUGGESTION", note: "nit" },
        { agent_id: "a2", persona: "Security", verdict: "did_not_flag", note: null },
      ],
      { title: "Only one flagged this" },
    );
    const realConflict = conflict(
      [
        { agent_id: "a1", persona: "Junior Mentor", verdict: "SUGGESTION", note: "nit" },
        { agent_id: "a2", persona: "Security", verdict: "CRITICAL", note: "live key" },
      ],
      { title: "Two agents differ here", line: 52 },
    );
    run = multiRun({ conflicts: [oneFlagged, realConflict] });
    renderView();

    expect(screen.getByText("Only one flagged this")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Only one flagged this")).not.toBeInTheDocument();
    expect(screen.getByText("Two agents differ here")).toBeInTheDocument();
  });

  it("states that the agents agreed instead of rendering an empty table", () => {
    // AC-52.
    run = multiRun({ conflicts: [] });
    renderView();
    expect(
      screen.getByText("The agents agreed on every location one of them flagged."),
    ).toBeInTheDocument();
  });

  it("never renders a column for an agent that was not in the run", () => {
    // The mockup's unselected Architecture column is a mockup error: the takes
    // the server sends ARE the agents of this run, and nothing adds to them.
    run = multiRun({ conflicts: [conflict(THREE_TAKES.slice(0, 2))] });
    renderView();

    const cluster = screen.getByText("Magic number 3600").closest("div")!.parentElement!;
    expect(within(cluster).queryByText("Architecture")).not.toBeInTheDocument();
  });
});
