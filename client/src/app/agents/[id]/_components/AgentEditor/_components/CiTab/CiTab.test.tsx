import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/ci.json";

vi.mock("./_components/ExportCiWizard", () => ({
  ExportCiWizard: () => <div data-testid="export-ci-wizard" />,
}));

import { CiTab } from "./CiTab";

const AGENT = { id: "a1", name: "Security Reviewer", skill_count: 2 } as Agent;

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
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

  it("claims no installation, no repo count and no run history (AC-3)", () => {
    renderTab();
    // The mockup's CI tab asserted all three; this cut persists nothing, so it
    // must not imply any of them.
    expect(screen.queryByText(/Active in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/installed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/succeeded/i)).not.toBeInTheDocument();
  });

  it("says plainly that nothing is written to a repository", () => {
    renderTab();
    expect(screen.getByText(/Nothing is written to any repository/)).toBeInTheDocument();
  });
});
