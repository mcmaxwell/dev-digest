import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentRunEstimate, PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

let pulls: PrMeta[] = [];
let agents: Agent[] = [];
let estimates: AgentRunEstimate[] = [];
const startMutate = vi.fn();

vi.mock("@/lib/hooks", () => ({
  usePulls: () => ({ data: pulls, isLoading: false }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: agents, isLoading: false }),
}));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentRunEstimates: () => ({ data: estimates }),
  useStartMultiAgentRun: () => ({
    mutate: startMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { agentColor } from "../../../_components/agent-colors";
import { MultiAgentConfigureView } from "./MultiAgentConfigureView";

afterEach(() => {
  cleanup();
  pulls = [];
  agents = [];
  estimates = [];
  startMutate.mockClear();
  push.mockClear();
  replace.mockClear();
});

function pr(over: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr-482",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rl",
    base: "main",
    head_sha: "abc",
    additions: 1,
    deletions: 0,
    files_count: 1,
    status: "needs_review",
    ...over,
  } as PrMeta;
}

function agent(over: Partial<Agent>): Agent {
  return {
    id: "a1",
    name: "Security",
    description: "Looks for secrets and injection paths.",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "",
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    ...over,
  } as Agent;
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">
        <MultiAgentConfigureView repoId="r1" />
      </div>
    </NextIntlClientProvider>,
  );
}

/** Choose the pull request through the real SearchableSelect. */
function choosePr(label = "#482 · Add rate limiting to public API endpoints") {
  fireEvent.click(screen.getByText("Select a pull request…"));
  fireEvent.click(screen.getByText(label));
}

const THREE_AGENTS = [
  agent({ id: "a2", name: "Performance", description: "Watches for N+1 queries." }),
  agent({ id: "a1", name: "Architecture", description: "Watches for duplicated clients." }),
  agent({ id: "a3", name: "Security", description: "Looks for secrets and injection paths." }),
];

describe("MultiAgentConfigureView - before a pull request is chosen", () => {
  it("replaces the agent step with a message and keeps the run control disabled at (0)", () => {
    pulls = [pr()];
    agents = THREE_AGENTS;
    renderView();

    // AC-3.
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    // AC-4 and AC-7: disabled, and the counter reflects the REAL selection.
    const run = screen.getByRole("button", { name: /Run multi-agent review/ });
    expect(run).toBeDisabled();
    expect(run).toHaveTextContent("Run multi-agent review (0)");
  });
});

describe("MultiAgentConfigureView - choosing agents", () => {
  it("lists every enabled agent by name with only its icon, name and description", () => {
    pulls = [pr()];
    agents = [...THREE_AGENTS, agent({ id: "a4", name: "Disabled one", enabled: false })];
    renderView();
    choosePr();

    // AC-5: every ENABLED agent, sorted by name ascending.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    expect(screen.queryByText("Disabled one")).not.toBeInTheDocument();
    const names = ["Architecture", "Performance", "Security"];
    names.forEach((n) => expect(screen.getByText(n)).toBeInTheDocument());
    const rendered = screen.getAllByText(/^(Architecture|Performance|Security)$/);
    expect(rendered.map((el) => el.textContent)).toEqual(names);

    // AC-6: the agent's own description, and NO duration, cost or verdict.
    expect(screen.getByText("Looks for secrets and injection paths.")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/\ds$/)).not.toBeInTheDocument();
  });

  it("keeps its own subtitle and gives every agent a colour of its own", () => {
    // Fix R1 step 4: this sentence belongs HERE, on the screen that picks a
    // pull request - not on the landing page it leaked to.
    // Fix R1 step 2: the row's icon tile is the agent's colour swatch, in the
    // same name-ascending order the results columns arrive in.
    pulls = [pr()];
    agents = THREE_AGENTS;
    renderView();
    choosePr();

    expect(screen.getByText(/Pick a pull request and choose which agents to fan out/)).toBeInTheDocument();

    const tiles = screen.getAllByTestId("agent-swatch");
    expect(tiles).toHaveLength(3);
    tiles.forEach((tile, i) => expect(tile).toHaveStyle({ color: agentColor(i) }));
    expect(new Set(tiles.map((t) => t.style.color)).size).toBe(3);
  });

  it("stays disabled at one agent, states why, and enables at two", () => {
    pulls = [pr()];
    agents = THREE_AGENTS;
    renderView();
    choosePr();

    const run = () => screen.getByRole("button", { name: /Run multi-agent review/ });
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    // AC-8, plus the reason stated beside the control.
    expect(run()).toBeDisabled();
    expect(run()).toHaveTextContent("Run multi-agent review (1)");
    expect(screen.getByText("Select at least two agents to compare.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(run()).toBeEnabled();
    expect(run()).toHaveTextContent("Run multi-agent review (2)");
    expect(screen.queryByText("Select at least two agents to compare.")).not.toBeInTheDocument();
  });

  it("selects every listed agent with select-all and places no upper limit", () => {
    pulls = [pr()];
    agents = THREE_AGENTS;
    renderView();
    choosePr();

    // AC-10, and AC-9: selecting them ALL leaves the control enabled.
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    for (const cb of screen.getAllByRole("checkbox")) expect(cb).toBeChecked();
    const run = screen.getByRole("button", { name: /Run multi-agent review/ });
    expect(run).toBeEnabled();
    expect(run).toHaveTextContent("Run multi-agent review (3)");
  });

  it("starts the run and lands on the new run's results", () => {
    pulls = [pr()];
    agents = THREE_AGENTS;
    renderView();
    choosePr();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: /Run multi-agent review/ }));

    expect(startMutate).toHaveBeenCalledTimes(1);
    const [vars, opts] = startMutate.mock.calls[0]!;
    expect(vars).toEqual({ prId: "pr-482", agentIds: ["a1", "a2", "a3"] });

    // Amendment 01: land on the results, so BACK reaches the landing list
    // rather than a half-filled form.
    opts.onSuccess({ id: "mar-1" });
    expect(replace).toHaveBeenCalledWith("/repos/r1/multi-agent/mar-1");
  });
});

describe("MultiAgentConfigureView - the estimate", () => {
  const withHistory = () => {
    pulls = [pr()];
    agents = THREE_AGENTS;
  };

  it("is the max of the selected durations and the sum of the selected costs", () => {
    withHistory();
    estimates = [
      { agent_id: "a1", median_duration_ms: 9100, median_cost_usd: 0.07, samples: 4 },
      { agent_id: "a2", median_duration_ms: 7400, median_cost_usd: 0.05, samples: 6 },
      { agent_id: "a3", median_duration_ms: 8200, median_cost_usd: 0.06, samples: 10 },
    ];
    renderView();
    choosePr();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));

    // AC-11 (max, because they run in parallel) and AC-12 (sum).
    expect(screen.getByText("≈ 9.1s · $0.18")).toBeInTheDocument();
  });

  it("leaves an agent with no history out and marks the estimate partial", () => {
    withHistory();
    estimates = [
      { agent_id: "a1", median_duration_ms: null, median_cost_usd: null, samples: 0 },
      { agent_id: "a3", median_duration_ms: 8200, median_cost_usd: 0.06, samples: 10 },
    ];
    renderView();
    choosePr();
    // Architecture (no history) + Security (history).
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[2]!);

    // AC-13.
    expect(screen.getByText(/≈ 8\.2s · \$0\.06 \(partial/)).toBeInTheDocument();
  });

  it("shows nothing at all when no selected agent has ever succeeded", () => {
    withHistory();
    estimates = [
      { agent_id: "a1", median_duration_ms: null, median_cost_usd: null, samples: 0 },
      { agent_id: "a2", median_duration_ms: null, median_cost_usd: null, samples: 0 },
    ];
    renderView();
    choosePr();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);

    // AC-14: an invented number would be worse than none.
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });
});

describe("MultiAgentConfigureView - empty repository", () => {
  it("says the repository has no pull requests and keeps the control disabled", () => {
    agents = THREE_AGENTS;
    renderView();

    expect(
      screen.getByText("This repository has no imported pull requests yet."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run multi-agent review/ })).toBeDisabled();
  });
});

describe("MultiAgentConfigureView - one row, scoped", () => {
  it("keeps each agent's description with its own name", () => {
    pulls = [pr()];
    agents = THREE_AGENTS;
    renderView();
    choosePr();

    const row = screen.getByText("Performance").closest("div")!.parentElement!;
    expect(within(row).getByText("Watches for N+1 queries.")).toBeInTheDocument();
  });
});
