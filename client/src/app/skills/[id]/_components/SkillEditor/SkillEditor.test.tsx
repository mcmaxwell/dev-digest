import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const push = vi.fn();
const rollbackMutate = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillStats: () => ({
    data: {
      agents: [{ id: "ag1", name: "Security Reviewer", enabled: true }],
      runs_count: 4,
      last_run_at: "2026-08-01T10:00:00.000Z",
      findings_count: 7,
      accepted_count: 3,
      dismissed_count: 1,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSkillVersions: () => ({
    data: [
      { skill_id: "s1", version: 2, body: "# Gate v2", created_at: "2026-08-02T10:00:00.000Z" },
      { skill_id: "s1", version: 1, body: "# Gate v1", created_at: "2026-08-01T10:00:00.000Z" },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useRollbackSkill: () => ({ mutate: rollbackMutate, isPending: false }),
}));

import { SkillEditor } from "./SkillEditor";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SKILL: Skill = {
  id: "s1",
  name: "secret-leakage-gate",
  description: "Treat credential-shaped literals as CRITICAL.",
  type: "security",
  source: "manual",
  body: "# Gate v2",
  enabled: true,
  version: 2,
};

function renderEditor(tab: string, onTab = () => {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillEditor skill={SKILL} tab={tab} onTab={onTab} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillEditor", () => {
  it("renders all three tabs and the Config form", () => {
    renderEditor("config");
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Statistics")).toBeInTheDocument();
    expect(screen.getByText("Version history")).toBeInTheDocument();
    expect(screen.getByDisplayValue("secret-leakage-gate")).toBeInTheDocument();
    expect(screen.getByDisplayValue("# Gate v2")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("Statistics tab shows the derived counts and attached agents", () => {
    renderEditor("stats");
    expect(screen.getByText("4")).toBeInTheDocument(); // runs
    expect(screen.getByText("7")).toBeInTheDocument(); // findings
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Attached agents")).toBeInTheDocument();
  });

  it("Version history lists snapshots newest-first; only past versions can be restored", () => {
    renderEditor("history");
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
    // exactly ONE restore button (v1) — the current version has none
    const restore = screen.getAllByText("Restore");
    expect(restore).toHaveLength(1);
  });

  it("restoring a past version confirms, then calls the rollback mutation", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEditor("history");
    fireEvent.click(screen.getByText("Restore"));
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(rollbackMutate).toHaveBeenCalledWith(
      { id: "s1", version: 1 },
      expect.anything(),
    );
    confirmSpy.mockRestore();
  });

  it("expanding a version row reveals that version's body", () => {
    renderEditor("history");
    expect(screen.queryByText("# Gate v1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("v1"));
    expect(screen.getByText("# Gate v1")).toBeInTheDocument();
  });
});
