import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The panel reads the PR's file patches to cut an eval case from a finding
// (L06). Mocked rather than served from a real QueryClient so this file stays
// what it is: a render test with no network and no provider tree.
vi.mock("@/lib/hooks", () => ({
  usePullDetail: () => ({
    data: {
      files: [
        {
          path: "src/config.ts",
          additions: 1,
          deletions: 0,
          patch: '@@ -9,3 +9,4 @@\n const a = 1;\n+const key = "sk_live_x";\n const b = 2;',
        },
      ],
    },
  }),
}));

vi.mock("@/components/eval-case-modal", () => ({
  EvalCaseModal: ({ initial }: { initial?: { name: string } }) => (
    <div data-testid="eval-case-modal">{initial?.name}</div>
  ),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

/**
 * Revealing the finding a severity mark in the diff pointed at (`?finding=`).
 *
 * The reveal is a ONE-SHOT command, not an invariant. Held as an invariant it
 * fights the user: "hide low confidence" springs straight back on every toggle
 * for as long as the param sits in the URL — and it only clears on an explicit
 * tab change, so a reload or a shared link leaves the filter stuck.
 */
describe("FindingsPanel reveal", () => {
  // jsdom implements neither; the panel scrolls the revealed card.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  const withConfidence = (id: string, title: string, confidence: number): FindingRecord =>
    ({ ...FINDINGS[0]!, id, title, confidence }) as FindingRecord;

  // LOW_CONFIDENCE_THRESHOLD is 0.65, so this one hides behind the filter.
  const LOW = withConfidence("low", "Low confidence finding", 0.2);
  const HIGH = withConfidence("high", "High confidence finding", 0.95);

  const renderPanel = (focusFindingId: string | null = null) =>
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={[HIGH, LOW]} prId="pr-1" focusFindingId={focusFindingId} />
      </NextIntlClientProvider>,
    );

  it("lifts the confidence filter so the revealed finding is not hidden", () => {
    renderPanel("low");
    expect(screen.getByText("Low confidence finding")).toBeInTheDocument();
  });

  it("scrolls the revealed card into view", () => {
    renderPanel("low");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("still lets the user hide low confidence afterwards", () => {
    // The regression: the reveal re-fired on every render, so the toggle sprang
    // straight back and the filter was unusable while ?finding= was set.
    renderPanel("low");
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Low confidence finding")).not.toBeInTheDocument();
    expect(screen.getByText("High confidence finding")).toBeInTheDocument();
  });

  it("leaves the filter alone when nothing is being revealed", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Low confidence finding")).not.toBeInTheDocument();
  });

  it("ignores a finding id owned by another run's panel", () => {
    renderPanel("not-in-this-panel");
    expect(screen.getByText("High confidence finding")).toBeInTheDocument();
    expect(screen.getByText("Low confidence finding")).toBeInTheDocument();
  });
});

describe("turn a finding into an eval case (L06)", () => {
  const decided = (patch: Partial<FindingRecord>): FindingRecord[] => [
    { ...FINDINGS[0]!, ...patch },
  ];

  it("offers the button only when there is an agent to file the case against", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();

    cleanup();
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" agentId="a1" />);
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
  });

  it("derives must_find from an accepted finding", () => {
    renderWithIntl(
      <FindingsPanel
        findings={decided({ accepted_at: "2026-08-27T10:00:00Z" })}
        prId="pr1"
        agentId="a1"
      />,
    );
    fireEvent.click(screen.getByText("Turn into eval case"));
    // The modal is stubbed; what matters is that a prefill was built at all,
    // named after the finding it came from.
    expect(screen.getByTestId("eval-case-modal")).toHaveTextContent("hardcoded-secret");
  });

  it("builds no case when the finding's file is not in the PR's files", () => {
    renderWithIntl(
      <FindingsPanel
        findings={decided({ file: "src/absent.ts" })}
        prId="pr1"
        agentId="a1"
      />,
    );
    fireEvent.click(screen.getByText("Turn into eval case"));
    // No patch to cut a diff from, so nothing opens rather than a case whose
    // diff would score zero whatever the agent does.
    expect(screen.queryByTestId("eval-case-modal")).not.toBeInTheDocument();
  });
});
