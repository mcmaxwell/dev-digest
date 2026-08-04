import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate, ConventionsPage } from "@devdigest/shared";
import messages from "../../../../../messages/en/conventions.json";
import skillMessages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const candidate = (over: Partial<ConventionCandidate> = {}): ConventionCandidate => ({
  id: "c1",
  category: "api-contract",
  rule: "Route handlers validate input with a `zod` schema declared next to the route.",
  rationale: "Invalid input is rejected before the handler runs.",
  evidence: [
    { path: "src/modules/things/routes.ts", line: 7, snippet: "app.post('/things', …)", verified: "exact", sha: "deadbeef" },
    { path: "src/modules/repos/routes.ts", line: 6, snippet: "app.get('/repos/:id', …)", verified: "relocated", sha: "deadbeef" },
  ],
  confidence: 0.9,
  adherence: 0.94,
  support: 47,
  violations: 3,
  origin: "llm",
  status: "pending",
  edited: false,
  ...over,
});

const CANDIDATES: ConventionCandidate[] = [
  candidate(),
  candidate({
    id: "c2",
    category: "types",
    rule: "TypeScript runs in `strict` mode.",
    rationale: null,
    origin: "config",
    confidence: 1,
    adherence: null,
    support: null,
    violations: null,
    status: "accepted",
    evidence: [
      { path: "tsconfig.json", line: 4, snippet: '"strict": true,', verified: "exact" },
    ],
  }),
];

const page: ConventionsPage = {
  scan: {
    id: "scan-1",
    repo_id: "r1",
    status: "done",
    sha: "deadbeef",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    sample_count: 18,
    candidate_count: 2,
    error: null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  },
  candidates: CANDIDATES,
};

const state = {
  page: page as ConventionsPage | undefined,
  isLoading: false,
  isError: false,
};
const extractMutate = vi.fn().mockResolvedValue({ scanId: "s", jobId: "j" });
const updateMutate = vi.fn();
const draftMutate = vi.fn().mockResolvedValue([
  {
    name: "payments-api-conventions",
    description: "1 house convention extracted from payments-api",
    type: "convention",
    body: "# payments-api-conventions",
    candidate_ids: ["c2"],
  },
]);

vi.mock("@/lib/shell-crumb", () => ({ useSetCrumb: () => {} }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
    repos: [],
    repoId: "r1",
    setRepoId: () => {},
    reposLoaded: true,
  }),
}));
vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({
    data: state.page,
    isLoading: state.isLoading,
    isError: state.isError,
    refetch: vi.fn(),
  }),
  useExtractConventions: () => ({ mutateAsync: extractMutate, isPending: false }),
  useUpdateConvention: () => ({ mutate: updateMutate, isPending: false }),
  useConventionSkillDraft: () => ({
    mutateAsync: draftMutate,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [{ id: "a1", name: "API Contract Reviewer" }] }),
  useAgentSkills: () => ({ data: [] }),
  useSetAgentSkills: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ConventionsView } from "./ConventionsView";

function tree() {
  return (
    <NextIntlClientProvider locale="en" messages={{ conventions: messages, skills: skillMessages }}>
      <ToastProvider>
        <ConventionsView />
      </ToastProvider>
    </NextIntlClientProvider>
  );
}

function renderView() {
  return render(tree());
}

beforeEach(() => {
  state.page = page;
  state.isLoading = false;
  state.isError = false;
  extractMutate.mockClear();
  updateMutate.mockClear();
  draftMutate.mockClear();
});
afterEach(cleanup);

describe("ConventionsView", () => {
  it("heads the page with the repo and what the scan actually read", () => {
    renderView();
    expect(screen.getByText("payments-api")).toBeInTheDocument();
    expect(screen.getByText(/Detected from 18 sample files/)).toBeInTheDocument();
  });

  it("groups candidates by category", () => {
    renderView();
    expect(screen.getByText("API contract")).toBeInTheDocument();
    expect(screen.getByText("Types")).toBeInTheDocument();
  });

  it("shows every rule with its grounded file:line evidence", () => {
    renderView();
    expect(screen.getByText(/Route handlers validate input/)).toBeInTheDocument();
    expect(screen.getByText("src/modules/things/routes.ts:7")).toBeInTheDocument();
    expect(screen.getByText("tsconfig.json:4")).toBeInTheDocument();
  });

  it("links evidence to GitHub pinned at the sha it was verified against", () => {
    renderView();
    const link = screen.getByText("src/modules/things/routes.ts:7").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/deadbeef/src/modules/things/routes.ts#L7",
    );
    // Evidence stored before the sha existed has no permalink to pin — it must
    // render as plain text, never as a link to the wrong commit.
    expect(screen.getByText("tsconfig.json:4").closest("a")).toBeNull();
  });

  it("requests the skill draft once, not again on every parent re-render", async () => {
    const view = renderView();
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    expect(await screen.findByDisplayValue("payments-api-conventions")).toBeInTheDocument();
    expect(draftMutate).toHaveBeenCalledTimes(1);

    // A poll tick or toast re-renders the parent with fresh array identities;
    // re-requesting the draft would overwrite whatever the user already edited.
    view.rerender(tree());
    expect(draftMutate).toHaveBeenCalledTimes(1);
  });

  it("reports the MEASURED adherence, not just the model's confidence", () => {
    renderView();
    expect(screen.getByText("Followed in 94% of matching sites")).toBeInTheDocument();
    // The config-derived rule shipped no probe — say so rather than implying a score.
    expect(screen.getByText("Not measured")).toBeInTheDocument();
  });

  it("marks a config-derived candidate as such", () => {
    renderView();
    expect(screen.getByText("from config")).toBeInTheDocument();
  });

  it("counts accepted candidates and enables Create skill only when some exist", () => {
    renderView();
    expect(screen.getByText("1 of 2 accepted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeEnabled();
  });

  it("accepts a pending candidate", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "accepted" } });
  });

  it("un-accepts an already-accepted candidate (the verdict is reversible)", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "c2", patch: { status: "pending" } });
  });

  it("rejects a candidate", () => {
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: "Reject" })[0]!);
    expect(updateMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "rejected" } });
  });

  it("edits a rule inline and saves the new wording", () => {
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit rule" })[0]!);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Routes declare their zod schema inline." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: "c1",
      patch: { rule: "Routes declare their zod schema inline." },
    });
  });

  it("does not fire an update when an edit is cancelled", () => {
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit rule" })[0]!);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Something else entirely." } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("deselects every accepted candidate at once", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "c2", patch: { status: "pending" } });
  });

  it("triggers an extraction from the toolbar", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Re-scan" }));
    expect(extractMutate).toHaveBeenCalled();
  });

  it("offers to run the first extraction when nothing has been scanned", () => {
    state.page = { scan: null, candidates: [] };
    renderView();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Run extraction" }).length).toBeGreaterThan(0);
  });

  it("explains an un-cloned repo instead of showing an empty result", () => {
    // "0 conventions" and "we could not read the repo" are very different
    // messages — the empty state must not stand in for the failure.
    state.page = {
      scan: { ...page.scan!, status: "error", error: "repo_not_cloned", candidate_count: 0 },
      candidates: [],
    };
    renderView();
    expect(screen.getByText("The last scan failed")).toBeInTheDocument();
    expect(screen.getByText(/has not been cloned yet/)).toBeInTheDocument();
  });

  it("surfaces a load error with a retry", () => {
    state.page = undefined;
    state.isError = true;
    renderView();
    expect(within(screen.getByRole("alert")).getByText("Could not load conventions.")).toBeInTheDocument();
  });
});
