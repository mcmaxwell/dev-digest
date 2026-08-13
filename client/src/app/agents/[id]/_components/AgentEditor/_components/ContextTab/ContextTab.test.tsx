import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { AgentContext, ProjectDoc } from "@/lib/types";
import messages from "../../../../../../../../messages/en/context.json";

const ALL_DOCS: ProjectDoc[] = [
  { path: "docs/architecture.md", category: "docs", size_bytes: 800, tokens: 200, used_by_agents: 1 },
  { path: "specs/public-api.md", category: "specs", size_bytes: 700, tokens: 184, used_by_agents: 2 },
  { path: "insights/incident.md", category: "insights", size_bytes: 500, tokens: 120, used_by_agents: 0 },
];

let available: ProjectDoc[];

const attach = (path: string, over: Partial<AgentContext["direct"][number]> = {}) => ({
  repo_id: "r1",
  repo_full_name: "acme/payments-api",
  path,
  tokens: 184,
  status: "ok" as const,
  origin: "direct" as const,
  skill_name: null,
  ...over,
});

let context: AgentContext;
const setDocs = vi.fn();

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/payments-api" } }),
}));
vi.mock("@/lib/hooks/project-context", () => ({
  useAgentContext: () => ({ data: context }),
  useProjectDocs: () => ({ data: { docs: available, scan: null } }),
  useSetAgentContextDocs: () => ({ mutate: setDocs, isPending: false }),
}));

import { ContextTab } from "./ContextTab";

const AGENT = { id: "ag1", name: "Security" } as Agent;

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  setDocs.mockClear();
  available = [...ALL_DOCS];
  context = {
    active_repo_id: "r1",
    direct: [attach("specs/public-api.md"), attach("docs/architecture.md", { tokens: 200 })],
    inherited: [],
    available_count: 3,
    tokens_total: 384,
  };
});
afterEach(cleanup);

describe("L05 agent ContextTab", () => {
  it("shows the N of M badge, the token footer, and attaches a document", () => {
    renderTab();
    expect(screen.getByText("2 of 3 attached")).toBeInTheDocument();
    expect(screen.getByText("≈ 384 tokens")).toBeInTheDocument();

    // Attaching appends to the ordered set and persists the FULL array.
    const row = screen.getByText("insights/incident.md").closest("label")!;
    fireEvent.click(row.querySelector('[role="checkbox"]')!);
    expect(setDocs).toHaveBeenCalledWith({
      docs: [
        { repo_id: "r1", path: "specs/public-api.md" },
        { repo_id: "r1", path: "docs/architecture.md" },
        { repo_id: "r1", path: "insights/incident.md" },
      ],
    });
  });

  it("reorders attached documents from the keyboard alone, with no pointer", () => {
    renderTab();

    // Every attached row carries a labelled reorder control; the ends are
    // disabled rather than missing.
    expect(screen.getByRole("button", { name: "Move specs/public-api.md up" })).toBeDisabled();
    const down = screen.getByRole("button", { name: "Move specs/public-api.md down" });
    expect(down).toBeEnabled();

    // Keyboard only, no pointer: the control is a real focusable <button>, so
    // it is Tab-reachable and Enter/Space activate it. `detail: 0` is what a
    // browser sets on a keyboard-originated click; this repo has no
    // `@testing-library/user-event`, so the activation is dispatched directly.
    down.focus();
    expect(down).toHaveFocus();
    expect(down.tagName).toBe("BUTTON");
    fireEvent.click(down, { detail: 0 });

    expect(setDocs).toHaveBeenCalledWith({
      docs: [
        { repo_id: "r1", path: "docs/architecture.md" },
        { repo_id: "r1", path: "specs/public-api.md" },
      ],
    });
  });

  it("warns above 16,000 tokens and names the 20,000-token run budget", () => {
    context.direct = [attach("specs/public-api.md", { tokens: 17_000 })];
    renderTab();

    const footer = screen.getByText(/≈ 17000 tokens/);
    expect(footer).toHaveTextContent("over 16000");
    expect(footer).toHaveTextContent("20000-token run budget");
  });

  it("lists inherited documents with neither reorder nor detach", () => {
    context.inherited = [
      attach("insights/incident.md", { origin: "skill", skill_name: "Security Baseline", tokens: 120 }),
    ];
    renderTab();

    expect(screen.getByText("Inherited from skills")).toBeInTheDocument();
    expect(screen.getByText("via Security Baseline")).toBeInTheDocument();

    const row = screen.getAllByTestId("context-doc-row").find((r) =>
      within(r).queryByText("via Security Baseline"),
    )!;
    expect(within(row).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
  });

  it("groups another repository's attachments and marks them unusable here", () => {
    context.direct = [
      attach("specs/public-api.md"),
      attach("docs/other.md", { repo_id: "r2", repo_full_name: "acme/other-api", tokens: 90 }),
    ];
    renderTab();

    expect(screen.getByText("Other repository: acme/other-api")).toBeInTheDocument();
    expect(screen.getByText("not used on this repo")).toBeInTheDocument();
  });

  it("marks an attachment missing from the latest scan, and keeps its detach working", () => {
    context.direct = [attach("docs/deleted.md", { status: "missing", tokens: 0 })];
    renderTab();

    expect(screen.getByText("missing")).toBeInTheDocument();
    const row = screen.getByText("docs/deleted.md").closest("label")!;
    fireEvent.click(row.querySelector('[role="checkbox"]')!);
    expect(setDocs).toHaveBeenCalledWith({ docs: [] });
  });

  it("renders a no-match row with a control that clears the filter", () => {
    renderTab();
    const filter = screen.getByRole("textbox", { name: "Filter documents…" });
    fireEvent.change(filter, { target: { value: "zzz-nothing" } });

    expect(screen.getByText("No document matches “zzz-nothing”.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByText("insights/incident.md")).toBeInTheDocument();
  });

  it("shows 0 of 0 attached with a link to the Project Context page", () => {
    available = [];
    context = { active_repo_id: "r1", direct: [], inherited: [], available_count: 0, tokens_total: 0 };
    renderTab();

    expect(screen.getByText("0 of 0 attached")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Project Context" })).toHaveAttribute(
      "href",
      "/repos/r1/context",
    );
  });
});
