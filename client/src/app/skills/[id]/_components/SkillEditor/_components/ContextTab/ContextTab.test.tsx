import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import type { ProjectDoc, SkillContext } from "@/lib/types";
import messages from "../../../../../../../../messages/en/context.json";

const ALL_DOCS: ProjectDoc[] = [
  { path: "specs/public-api.md", category: "specs", size_bytes: 700, tokens: 184, used_by_agents: 2 },
  { path: "docs/architecture.md", category: "docs", size_bytes: 800, tokens: 200, used_by_agents: 1 },
];

let available: ProjectDoc[];
let context: SkillContext;
const setDocs = vi.fn();

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/payments-api" } }),
}));
vi.mock("@/lib/hooks/project-context", () => ({
  useSkillContext: () => ({ data: context }),
  useProjectDocs: () => ({ data: { docs: available, scan: null } }),
  useSetSkillContextDocs: () => ({ mutate: setDocs, isPending: false }),
}));

import { ContextTab } from "./ContextTab";

const SKILL = { id: "sk1", name: "Security Baseline" } as Skill;

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  setDocs.mockClear();
  available = [...ALL_DOCS];
  context = {
    docs: [
      {
        repo_id: "r1",
        repo_full_name: "acme/payments-api",
        path: "specs/public-api.md",
        tokens: 184,
        status: "ok",
        origin: "direct",
        skill_name: null,
      },
    ],
    tokens_total: 184,
  };
});
afterEach(cleanup);

describe("L05 skill ContextTab", () => {
  it("attaches a document and persists the full set", () => {
    renderTab();
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();

    const row = screen.getByText("docs/architecture.md").closest("label")!;
    fireEvent.click(row.querySelector('[role="checkbox"]')!);
    expect(setDocs).toHaveBeenCalledWith({
      docs: [
        { repo_id: "r1", path: "specs/public-api.md" },
        { repo_id: "r1", path: "docs/architecture.md" },
      ],
    });
  });

  it("renders a CONTRIBUTES manifest of paths with their token estimates", () => {
    renderTab();
    expect(screen.getByText("CONTRIBUTES")).toBeInTheDocument();
    expect(screen.getByText("- specs/public-api.md · ≈184 tok")).toBeInTheDocument();
  });

  it("says so plainly when the skill contributes nothing", () => {
    context = { docs: [], tokens_total: 0 };
    renderTab();
    expect(
      screen.getByText("No documents attached, so this skill contributes no project context."),
    ).toBeInTheDocument();
  });

  it("offers no reorder control — a skill's documents have no ordering semantics", () => {
    renderTab();
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
  });
});
