import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const mutateToggle = vi.fn();

const SKILLS: Skill[] = [
  {
    id: "s1",
    name: "secret-leakage-gate",
    description: "Treat credential-shaped literals as CRITICAL.",
    type: "security",
    source: "manual",
    body: "# Gate",
    enabled: true,
    version: 2,
  },
  {
    id: "s2",
    name: "flaky-test-patterns",
    description: "Flag flaky test patterns.",
    type: "convention",
    source: "imported_file",
    body: "# Flakes",
    enabled: false,
    version: 1,
  },
];

vi.mock("@/lib/shell-crumb", () => ({ useSetCrumb: () => {} }));
// the preview drawer's "Open editor" button navigates to /skills/:id
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: mutateToggle, isPending: false }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportSkillPreview: () => ({
    mutate: vi.fn(),
    data: undefined,
    isPending: false,
    isError: false,
  }),
}));

import { SkillsView } from "./SkillsView";

afterEach(cleanup);

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillsView />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("L02 SkillsView (smoke)", () => {
  it("renders skill cards with type badges and the needs-vetting marker", () => {
    renderView();
    expect(screen.getByText("secret-leakage-gate")).toBeInTheDocument();
    expect(screen.getByText("flaky-test-patterns")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
    // imported + disabled = needs vetting
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it("opens the preview drawer with an editable body when a card is clicked", () => {
    renderView();
    fireEvent.click(screen.getByText("secret-leakage-gate"));
    expect(screen.getByText("Skill body (Markdown)")).toBeInTheDocument();
    expect(screen.getByDisplayValue("# Gate")).toBeInTheDocument();
    // version chip appears on the card AND in the drawer title
    expect(screen.getAllByText("v2").length).toBeGreaterThan(1);
  });

  it("filters the grid by the search box", () => {
    renderView();
    fireEvent.change(screen.getByPlaceholderText("Search skills…"), {
      target: { value: "flaky" },
    });
    expect(screen.queryByText("secret-leakage-gate")).not.toBeInTheDocument();
    expect(screen.getByText("flaky-test-patterns")).toBeInTheDocument();
  });
});
