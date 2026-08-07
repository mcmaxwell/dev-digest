/**
 * SmartDiffViewer (L03) — the Files-changed tab in reviewer order.
 *
 * The grouping itself is the server's job and is tested there; what matters
 * here is that the reviewer's attention lands where it should: groups in
 * order, boilerplate closed, anything flagged open and marked, and the plain
 * diff still reachable when the grouping call fails.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, ReviewRecord, SmartDiffResponse } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

const smartDiff = vi.hoisted(() => vi.fn());
const prReviews = vi.hoisted(() => vi.fn());

// The mocks FORWARD their argument so the tests can prove the component passes
// prId — `useSmartDiff(null)` would silently disable the query in production
// (`enabled: !!prId`) and a swallowing mock would never notice.
vi.mock("@/lib/hooks/smart-diff", () => ({
  useSmartDiff: (prId: string | null) => smartDiff(prId),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: (prId: string | null) => prReviews(prId),
}));

afterEach(cleanup);

const FILES: PrFile[] = [
  {
    path: "src/middleware/ratelimit.ts",
    additions: 84,
    deletions: 0,
    patch: "@@ -24,2 +24,3 @@\n export async function rateLimit(req, res, next) {\n+  const key = bucketKey(req);\n",
  },
  {
    path: "src/config.ts",
    additions: 4,
    deletions: 0,
    patch:
      "@@ -10,3 +10,4 @@\n export const config = {\n   port: Number(process.env.PORT ?? 3000),\n+  stripeKey: \"sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc\",\n",
  },
  { path: "package-lock.json", additions: 92, deletions: 24, patch: "@@ -1,2 +1,2 @@\n-old\n+new\n" },
];

const DIFF: SmartDiffResponse = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/middleware/ratelimit.ts",
          pseudocode_summary: null,
          additions: 84,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        {
          path: "src/config.ts",
          pseudocode_summary: null,
          additions: 4,
          deletions: 0,
          finding_lines: [12],
        },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "package-lock.json",
          pseudocode_summary: null,
          additions: 92,
          deletions: 24,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 204, proposed_splits: [] },
};

const REVIEWS: ReviewRecord[] = [
  {
    id: "rev-1",
    pr_id: "pr-1",
    agent_id: "a1",
    run_id: null,
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: null,
    score: 61,
    model: "seed",
    grounding: "1/1 passed",
    created_at: "2026-08-07T10:00:00.000Z",
    findings: [
      {
        id: "f1",
        review_id: "rev-1",
        title: "Hardcoded Stripe secret key in commit",
        severity: "CRITICAL",
        category: "security",
        file: "src/config.ts",
        start_line: 12,
        end_line: 12,
        confidence: 0.98,
        rationale: "Live key committed in plaintext.",
        accepted_at: null,
        dismissed_at: null,
      },
    ],
  },
];

function renderViewer(over: Partial<React.ComponentProps<typeof SmartDiffViewer>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <SmartDiffViewer prId="pr-1" files={FILES} {...over} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  smartDiff.mockReturnValue({ data: DIFF, isLoading: false, isError: false });
  prReviews.mockReturnValue({ data: REVIEWS });
});

describe("SmartDiffViewer", () => {
  it("renders the groups in core → wiring → boilerplate order", () => {
    renderViewer();
    const headings = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(headings).toEqual(["Core logic", "Wiring", "Boilerplate"]);
  });

  it("explains what each role means rather than just naming it", () => {
    renderViewer();
    expect(screen.getByText("The substance of the change — review closely")).toBeInTheDocument();
    expect(screen.getByText("Generated / mechanical — skim")).toBeInTheDocument();
  });

  it("omits a group the server did not send", () => {
    smartDiff.mockReturnValue({
      data: { ...DIFF, groups: DIFF.groups.slice(0, 1) },
      isLoading: false,
      isError: false,
    });
    renderViewer();
    expect(screen.queryByRole("region", { name: "Boilerplate" })).not.toBeInTheDocument();
  });

  it("passes the prId through to both hooks", () => {
    renderViewer();
    expect(smartDiff).toHaveBeenCalledWith("pr-1");
    expect(prReviews).toHaveBeenCalledWith("pr-1");
  });

  it("opens core files and leaves boilerplate collapsed", () => {
    renderViewer();
    // The core file's patch text is rendered; the lock file's is not.
    // NB: assert the PARSED text — parsePatch strips the leading "+", so a
    // /^\+new$/ matcher can never match and the assertion would be vacuous.
    expect(screen.getByText(/const key = bucketKey/)).toBeInTheDocument();
    const boilerplate = screen.getByRole("region", { name: "Boilerplate" });
    expect(within(boilerplate).queryByText("new")).not.toBeInTheDocument();
  });

  it("drops a grouped path the PR detail has no file for", () => {
    smartDiff.mockReturnValue({
      data: {
        ...DIFF,
        groups: [
          {
            role: "boilerplate",
            files: [
              {
                path: "vendor/gone.lock",
                pseudocode_summary: null,
                additions: 1,
                deletions: 0,
                finding_lines: [],
              },
            ],
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    renderViewer();
    expect(screen.queryByText("vendor/gone.lock")).not.toBeInTheDocument();
    // It was the group's only file, so the whole section goes too.
    expect(screen.queryByRole("region", { name: "Boilerplate" })).not.toBeInTheDocument();
  });

  it("shows a loading state while the grouping is in flight", () => {
    smartDiff.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderViewer();
    expect(screen.getByText("Grouping changed files…")).toBeInTheDocument();
  });

  it("opens a flagged wiring file and marks the flagged line", () => {
    renderViewer();
    const wiring = screen.getByRole("region", { name: "Wiring" });
    // Expanded despite its role, because the last review flagged line 12.
    expect(within(wiring).getByText(/stripeKey/)).toBeInTheDocument();
    expect(within(wiring).getByText("1 finding")).toBeInTheDocument();
    // Icon + label, never colour alone.
    expect(within(wiring).getByText("Critical")).toBeInTheDocument();
  });

  it("drops the mark once the finding is dismissed", () => {
    prReviews.mockReturnValue({
      data: [
        {
          ...REVIEWS[0]!,
          findings: [{ ...REVIEWS[0]!.findings[0]!, dismissed_at: "2026-08-07T12:00:00.000Z" }],
        },
      ],
    });
    renderViewer();
    // The server still lists the line, so the file stays open and counted —
    // but with no live finding it must not claim a CRITICAL any more.
    expect(screen.queryByText("Critical")).not.toBeInTheDocument();
    expect(screen.getByText("1 finding")).toBeInTheDocument();
  });

  it("still marks a flagged line when the reviews have not loaded", () => {
    prReviews.mockReturnValue({ data: undefined });
    renderViewer();
    expect(screen.getByText("1 finding")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("hides the split banner on a PR that is not too big", () => {
    renderViewer();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the split banner with its proposed splits when the PR is too big", () => {
    smartDiff.mockReturnValue({
      data: {
        ...DIFF,
        split_suggestion: {
          too_big: true,
          total_lines: 1204,
          proposed_splits: [
            { name: "src/api", files: ["src/api/a.ts", "src/api/b.ts"] },
            { name: "src/billing", files: ["src/billing/c.ts"] },
          ],
        },
      },
      isLoading: false,
      isError: false,
    });
    renderViewer();
    const banner = screen.getByRole("status");
    expect(within(banner).getByText("This PR is large (1,204 changed lines)")).toBeInTheDocument();
    expect(within(banner).getByText("src/api")).toBeInTheDocument();
    expect(within(banner).getByText("· 2 files")).toBeInTheDocument();
  });

  it("warns but still shows the size when there is nothing to split into", () => {
    smartDiff.mockReturnValue({
      data: {
        ...DIFF,
        split_suggestion: { too_big: true, total_lines: 900, proposed_splits: [] },
      },
      isLoading: false,
      isError: false,
    });
    renderViewer();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      screen.queryByText("Consider splitting it into smaller, focused PRs for easier review:"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the plain diff when the grouping call fails", () => {
    smartDiff.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderViewer({ onUnavailable: <div>plain diff</div> });
    expect(screen.getByText(/Couldn't group the changed files/)).toBeInTheDocument();
    expect(screen.getByText("plain diff")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Core logic" })).not.toBeInTheDocument();
  });

  it("marks the flagged line in both themes", () => {
    (["dark", "light"] as const).forEach((theme) => {
      cleanup();
      render(
        <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
          <div data-theme={theme}>
            <SmartDiffViewer prId="pr-1" files={FILES} />
          </div>
        </NextIntlClientProvider>,
      );
      const wiring = screen.getByRole("region", { name: "Wiring" });
      expect(within(wiring).getByText("Critical")).toBeInTheDocument();
    });
  });
});
