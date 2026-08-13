import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

/** The trace the mocked hook returns; per-test overrides assign to it. */
let current: RunTrace = TRACE;

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: current, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  current = TRACE;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("COST")).toBeInTheDocument();
    expect(screen.getByText("$0.06")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});

describe("L05 project context in the trace", () => {
  const open = () => {
    renderWithIntl(
      <RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Prompt assembly"));
  };

  it("renders the project-context block, labelled untrusted, with a token badge", () => {
    current = {
      ...TRACE,
      prompt_assembly: {
        ...TRACE.prompt_assembly,
        specs: '<untrusted source="spec-0">\nNever expose internal account ids.\n</untrusted>',
        specs_tokens: 184,
        repo_map: "src/config.ts",
      },
    };
    open();

    const label = screen.getByText("Project context — attached specs (untrusted)");
    expect(label).toBeInTheDocument();
    expect(screen.getByText("≈184 tok")).toBeInTheDocument();

    // Order: the project-context block sits above the repo skeleton, matching
    // the order `assemblePrompt` renders them in.
    const repoMap = screen.getByText("Repo skeleton — repo-intel (dynamic)");
    expect(label.compareDocumentPosition(repoMap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("expands the block to the full stored text, delimiters included", () => {
    const specs = '<untrusted source="spec-0">\nNever expose internal account ids.\n</untrusted>';
    current = { ...TRACE, prompt_assembly: { ...TRACE.prompt_assembly, specs, specs_tokens: 184 } };
    open();

    fireEvent.click(screen.getByText("Project context — attached specs (untrusted)"));
    expect(screen.getByText(/<untrusted source="spec-0">/)).toBeInTheDocument();
    expect(screen.getByText(/<\/untrusted>/)).toBeInTheDocument();
  });

  it("renders statused specs-read entries with their tokens and origin", () => {
    current = {
      ...TRACE,
      specs_read: [
        { path: "specs/public-api.md", status: "ok", tokens: 184, origin: "agent" },
        { path: "docs/gone.md", status: "missing", tokens: 0, origin: "skill:Security Baseline" },
      ],
    };
    open();

    expect(screen.getByText("specs/public-api.md")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
    expect(screen.getByText("skill:Security Baseline")).toBeInTheDocument();
    expect(screen.getByText("≈184 tok")).toBeInTheDocument();
  });

  it("opens a pre-L05 trace whose specs_read is a plain string[]", () => {
    // The union is permanent: old traces carry bare paths and must still open.
    current = { ...TRACE, specs_read: ["specs/public-api.md", "docs/architecture.md"] };
    open();

    expect(screen.getByText("specs/public-api.md")).toBeInTheDocument();
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    // No status chips on an entry that never had one.
    expect(screen.queryByText("ok")).not.toBeInTheDocument();
  });
});
