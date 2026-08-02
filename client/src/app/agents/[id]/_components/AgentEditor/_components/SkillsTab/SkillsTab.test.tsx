import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

const setSkillsMutate = vi.fn();

const SKILLS: Skill[] = [
  {
    id: "s1",
    name: "secret-leakage-gate",
    description: "d",
    type: "security",
    source: "manual",
    body: "b",
    enabled: true,
    version: 1,
  },
  {
    id: "s2",
    name: "pr-quality-rubric",
    description: "d",
    type: "rubric",
    source: "manual",
    body: "b",
    enabled: true,
    version: 1,
  },
  {
    id: "s3",
    name: "no-then-chains",
    description: "d",
    type: "convention",
    source: "manual",
    body: "b",
    enabled: false,
    version: 1,
  },
];

vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgentSkills: () => ({
    data: [{ agent_id: "ag1", skill_id: "s2", order: 0 }],
  }),
  useSetAgentSkills: () => ({ mutate: setSkillsMutate, isPending: false }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(cleanup);
beforeEach(() => setSkillsMutate.mockClear());

const AGENT = { id: "ag1", name: "Sec" } as Agent;

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <SkillsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("L02 SkillsTab", () => {
  it("shows the linked count and marks globally-disabled skills", () => {
    renderTab();
    expect(screen.getByText("1 of 3 enabled")).toBeInTheDocument();
    expect(screen.getByText("disabled globally")).toBeInTheDocument();
  });

  it("attaching a skill persists the full ordered id list (existing links first)", () => {
    renderTab();
    const row = screen.getByText("secret-leakage-gate").closest("label")!;
    fireEvent.click(row.querySelector('[role="checkbox"]')!);
    expect(setSkillsMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["s2", "s1"] });
  });

  it("detaching a skill removes only that id", () => {
    renderTab();
    const row = screen.getByText("pr-quality-rubric").closest("label")!;
    fireEvent.click(row.querySelector('[role="checkbox"]')!);
    expect(setSkillsMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: [] });
  });
});
