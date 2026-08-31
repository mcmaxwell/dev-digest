import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiInstallation } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/ci.json";
import agentMessages from "../../../../../../../../messages/en/agents.json";

vi.mock("./_components/ExportCiWizard", () => ({
  ExportCiWizard: () => <div data-testid="export-ci-wizard" />,
}));

// The tab now reads installations and writes `ci_fail_on`, so both data hooks
// are stubbed here. No installation is the state these cases describe.
const installations: CiInstallation[] = [];
const updateMutate = vi.fn();

vi.mock("@/lib/hooks/ci", () => ({
  useCiInstallations: () => ({ data: installations }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: updateMutate, isPending: false }),
}));

import { CiTab } from "./CiTab";

const AGENT = { id: "a1", name: "Security Reviewer", skill_count: 2, ci_fail_on: "critical" } as Agent;

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages, agents: agentMessages }}>
      <CiTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("CiTab", () => {
  it("offers one control that opens the wizard (AC-2)", () => {
    renderTab();
    expect(screen.queryByTestId("export-ci-wizard")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Export to CI"));
    expect(screen.getByTestId("export-ci-wizard")).toBeInTheDocument();
  });

  // Supersedes the AC-3 case: installations are persisted now, so the tab
  // reports them - but only when there are any. With none it must still claim
  // nothing, which is what the old criterion was really protecting.
  it("claims no installation and no repo count when there are none", () => {
    renderTab();
    expect(screen.queryByText(/Active in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/installed /i)).not.toBeInTheDocument();
  });

  it("says plainly what installing writes, before anything is written", () => {
    renderTab();
    expect(screen.getByText(/Install opens a pull request/)).toBeInTheDocument();
  });
});
