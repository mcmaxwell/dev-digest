/**
 * PrBriefCard (L05) — where to start reading this PR.
 *
 * Four states, plus the four things a reader could be misled by if they were
 * wrong: a stale brief must show its contents rather than an empty state, a
 * degraded brief must not look like an error, the review-focus order must be
 * the stored order, and the dropped counts must be visible — without them a
 * brief that dropped nine of ten statements looks like one that dropped none.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BriefView, PrCommit } from "@devdigest/shared";
import brief from "../../../../../../../../messages/en/brief.json";
import { PrBriefCard } from "./PrBriefCard";

const usePrBrief = vi.hoisted(() => vi.fn());
const useGenerateBrief = vi.hoisted(() => vi.fn());

// The mocks FORWARD prId, so a component that stopped passing it (which would
// silently disable the query via `enabled: !!prId`) fails here.
vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: (prId: string | null) => usePrBrief(prId),
  useGenerateBrief: (prId: string | null) => useGenerateBrief(prId),
}));

// jsdom implements neither of these, and the diff-jump path uses the first.
Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

const RATELIMIT = "src/middleware/ratelimit.ts";

const VIEW: BriefView = {
  prose: {
    what: "It touches the rate limiter, which the public API server calls.",
    why: "It sets out to cap unauthenticated traffic.",
  },
  risk_level: "medium",
  risks: [
    {
      kind: "auth surface",
      title: "Auth surface touched",
      explanation: "The limiter runs before authentication.",
      severity: "medium",
      file_refs: [RATELIMIT, "src/config.ts"],
    },
  ],
  review_focus: [
    { file: "src/config.ts", line: 12, reason: "A key is set here." },
    { file: RATELIMIT, line: null, reason: "The 429 branch is new." },
  ],
  history: [
    {
      pr_number: 401,
      title: "Earlier limiter work",
      merged_at: "2026-05-01T00:00:00.000Z",
      author: "octocat",
      files_overlap: [RATELIMIT],
      notes: "",
    },
  ],
  brief_history: [
    {
      head_sha: "commit2",
      generated_at: "2026-08-14T10:00:00.000Z",
      risk_level: "medium",
      what: "It touches the rate limiter.",
    },
  ],
  dropped: { risks: 1, focus: 1, file_refs: 0, lines: 0, endpoints: 0, crons: 0 },
  meta: {
    provider: "openai",
    model: "gpt-4.1",
    head_sha: "commit2",
    indexed_sha: "indexedsha1",
    generated_at: "2026-08-14T10:00:00.000Z",
    stale: false,
  },
  index: {
    status: "ok",
    reason: "none",
    ranked: true,
    facts: true,
    graph: true,
    last_indexed_sha: "indexedsha1",
    indexed_at: "2026-08-10T10:00:00.000Z",
  },
  status: "ok",
  degraded_reason: null,
};

// OLDEST FIRST, with a `committed_at` on every entry — the shape
// `pulls.listCommits` actually returns (`adapters/github/octokit.ts`), which
// neither reverses nor sorts, and which `pulls/repository.ts#getCommits` reads
// back without an `orderBy`. A newest-first fixture here cannot fail against a
// component that renders the prop order verbatim.
const COMMITS: PrCommit[] = [
  {
    sha: "commit1",
    message: "first cut",
    author: "marisa.koch",
    committed_at: "2026-08-14T08:00:00.000Z",
  },
  {
    sha: "commit2",
    message: "cap unauthenticated traffic",
    author: "marisa.koch",
    committed_at: "2026-08-14T09:00:00.000Z",
  },
];

function view(over: Partial<BriefView> = {}): BriefView {
  return { ...VIEW, ...over };
}

const onOpenFile = vi.fn();

function renderCard(props: Partial<Parameters<typeof PrBriefCard>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief }}>
      <PrBriefCard
        prId="pr-1"
        commits={COMMITS}
        fileHref={(path) => `/repos/r/pulls/482?tab=diff&file=${path}`}
        onOpenFile={onOpenFile}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  onOpenFile.mockClear();
  usePrBrief.mockReturnValue({
    data: { brief: view() },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useGenerateBrief.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
});

describe("PrBriefCard states", () => {
  it("keeps the heading while loading, so it does not jump when data arrives", () => {
    usePrBrief.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderCard();
    expect(screen.getByText(brief.pr.title)).toBeTruthy();
  });

  it("offers a retry rather than a blank card when the fetch fails", () => {
    const refetch = vi.fn();
    usePrBrief.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderCard();

    expect(screen.getByText(brief.pr.errorTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows a generate control and no risk list when there is no brief", () => {
    const mutate = vi.fn();
    usePrBrief.mockReturnValue({ data: { brief: null }, isLoading: false, isError: false, refetch: vi.fn() });
    useGenerateBrief.mockReturnValue({ mutate, isPending: false, isError: false });
    renderCard();

    expect(screen.getByText(brief.pr.emptyTitle)).toBeTruthy();
    expect(screen.queryByText(brief.block.risks)).toBeNull();

    // Generation is never automatic — it takes a click.
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: brief.pr.generate }));
    expect(mutate).toHaveBeenCalled();
  });

  it("disables the control and shows a pending label while generating", () => {
    usePrBrief.mockReturnValue({ data: { brief: null }, isLoading: false, isError: false, refetch: vi.fn() });
    useGenerateBrief.mockReturnValue({ mutate: vi.fn(), isPending: true, isError: false });
    renderCard();

    const cta = screen.getByRole("button", { name: brief.pr.generating });
    expect((cta as HTMLButtonElement).disabled).toBe(true);
  });

  // Without this the empty state re-renders identically after a failed POST and
  // the click looks like it did nothing. A degraded 200 is a different path.
  it("says so when the generate request itself fails", () => {
    usePrBrief.mockReturnValue({ data: { brief: null }, isLoading: false, isError: false, refetch: vi.fn() });
    useGenerateBrief.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: true });
    renderCard();

    expect(screen.getByText(brief.pr.generateFailed)).toBeTruthy();
    // Still the empty state, not an error page: the CTA survives.
    expect(screen.getByRole("button", { name: brief.pr.generate })).toBeTruthy();
  });

  it("renders a degraded brief with its reason and a retry, never an error page", () => {
    const mutate = vi.fn();
    useGenerateBrief.mockReturnValue({ mutate, isPending: false, isError: false });
    usePrBrief.mockReturnValue({
      data: {
        brief: view({
          status: "degraded",
          degraded_reason: "index_degraded",
          risks: [],
          review_focus: [],
          prose: { what: "", why: "" },
        }),
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();

    expect(screen.getByText(brief.pr.degraded.index_degraded)).toBeTruthy();
    expect(screen.queryByText(brief.pr.errorTitle)).toBeNull();
    // The deterministic half is still there.
    expect(screen.getByText("Earlier limiter work")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: brief.pr.retry }));
    expect(mutate).toHaveBeenCalled();
  });

  it("shows the FULL contents beneath a stale badge, not an empty state", () => {
    usePrBrief.mockReturnValue({
      data: { brief: view({ meta: { ...VIEW.meta, stale: true } }) },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();

    expect(screen.getByText(brief.pr.stale)).toBeTruthy();
    expect(screen.getByText("Auth surface touched")).toBeTruthy();
    expect(screen.getByText(/A key is set here/)).toBeTruthy();
  });
});

describe("PrBriefCard content", () => {
  it("renders exactly one paragraph of generated prose", () => {
    renderCard();
    expect(
      screen.getByText(
        "It touches the rate limiter, which the public API server calls. It sets out to cap unauthenticated traffic.",
      ),
    ).toBeTruthy();
  });

  it("gives every risk a link whose accessible name contains the file path", () => {
    renderCard();
    const risks = within(screen.getByRole("list", { name: brief.block.risks }));
    for (const path of [RATELIMIT, "src/config.ts"]) {
      const link = risks.getByRole("link", {
        name: brief.pr.openFile.replace("{file}", path),
      });
      expect(link.getAttribute("href")).toContain(path);
    }
  });

  it("renders the review focus in the STORED order, not sorted", () => {
    renderCard();
    const rows = within(
      screen.getByRole("list", { name: brief.pr.focusTitle }),
    ).getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("src/config.ts:12");
    expect(rows[1]!.textContent).toContain(RATELIMIT);
  });

  it("crosses to the Files changed tab when a review-focus entry is activated", () => {
    renderCard();
    fireEvent.click(
      screen.getByRole("link", {
        name: brief.pr.openFileLine.replace("{file}", "src/config.ts").replace("{line}", "12"),
      }),
    );
    expect(onOpenFile).toHaveBeenCalledWith("src/config.ts");
  });

  it("reaches every file reference by keyboard and activates it with Enter", () => {
    renderCard();
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    // A real anchor with an href is focusable and Enter-activatable with no key
    // handler of our own, which is the property AC-40 asks for.
    for (const link of links) expect(link.getAttribute("href")).toBeTruthy();

    // `detail: 0` is what a browser sets on a keyboard-originated click; this
    // repo has no `@testing-library/user-event`. An anchor with an href needs
    // no key handler of ours for Enter to produce exactly this.
    links[0]!.focus();
    expect(document.activeElement).toBe(links[0]);
    fireEvent.click(links[0]!, { detail: 0 });
    expect(onOpenFile).toHaveBeenCalled();
  });

  it("distinguishes severity without relying on colour", () => {
    renderCard();
    // The written level sits beside the icon, so the ranking survives a
    // colour-blind reader and a monochrome screenshot alike.
    expect(screen.getAllByText(brief.pr.severity.medium).length).toBeGreaterThan(0);
  });

  it("states how many statements grounding dropped", () => {
    renderCard();
    expect(screen.getByText(brief.pr.droppedTitle)).toBeTruthy();
    expect(screen.getByText(/2 statements named things/)).toBeTruthy();
  });

  it("names the provider and model that wrote it", () => {
    renderCard();
    expect(screen.getByText("openai · gpt-4.1")).toBeTruthy();
  });

  it("says so plainly when nothing was flagged", () => {
    usePrBrief.mockReturnValue({
      data: { brief: view({ risks: [], review_focus: [], history: [] }) },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();
    expect(screen.getByText(brief.noRisks)).toBeTruthy();
    expect(screen.getByText(brief.pr.noFocus)).toBeTruthy();
    expect(screen.getByText(brief.noHistory)).toBeTruthy();
  });
});

describe("PrBriefCard brief history", () => {
  const timelineRows = () =>
    within(screen.getByRole("list", { name: brief.pr.historyTitle })).getAllByRole("listitem");

  it("renders the section for a single entry, and marks commits that have none", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /brief history/i }));

    expect(screen.getByText("It touches the rate limiter.")).toBeTruthy();
    // commit1 predates the first generation: shown WITH a marker, not omitted.
    expect(screen.getByText("commit1")).toBeTruthy();
    expect(screen.getByText(brief.pr.historyNone)).toBeTruthy();
  });

  it("orders the timeline newest first from the oldest-first commits it is given", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /brief history/i }));
    const rows = timelineRows();
    expect(rows[0]!.textContent).toContain("commit2");
    expect(rows[1]!.textContent).toContain("commit1");
  });

  it("orders by commit timestamp, not by the order the commits arrive in", () => {
    // `pulls/repository.ts#getCommits` has no `orderBy`, so the array can reach
    // the card in an order that is neither oldest- nor newest-first.
    const scrambled: PrCommit[] = [
      { ...COMMITS[1]!, committed_at: "2026-08-14T09:00:00.000Z" },
      { sha: "commit3", message: "handle 429", author: "marisa.koch", committed_at: "2026-08-14T10:00:00.000Z" },
      { ...COMMITS[0]!, committed_at: "2026-08-14T08:00:00.000Z" },
    ];
    renderCard({ commits: scrambled });
    fireEvent.click(screen.getByRole("button", { name: /brief history/i }));
    const rows = timelineRows();
    expect(rows.map((r) => r.textContent!.slice(0, 7))).toEqual([
      "commit3",
      "commit2",
      "commit1",
    ]);
    // The only commit WITH a brief sits between the two without one: a
    // brief-less commit keeps its place in the sequence (AC-46) instead of
    // being collected into a block of its own.
    expect(rows[1]!.textContent).toContain("It touches the rate limiter.");
    expect(rows[0]!.textContent).toContain(brief.pr.historyNone);
    expect(rows[2]!.textContent).toContain(brief.pr.historyNone);
  });

  it("still orders newest first when the platform supplies no commit timestamps", () => {
    // `adapters/mocks.ts` returns `committed_at: null` for every commit and the
    // column is nullable, so the oldest-first sequence is the only signal left.
    const undated: PrCommit[] = COMMITS.map((c) => ({ ...c, committed_at: null }));
    renderCard({ commits: undated });
    fireEvent.click(screen.getByRole("button", { name: /brief history/i }));
    const rows = timelineRows();
    expect(rows[0]!.textContent).toContain("commit2");
    expect(rows[1]!.textContent).toContain("commit1");
  });

  it("hides the section entirely when no brief has ever been generated for a commit", () => {
    usePrBrief.mockReturnValue({
      data: { brief: view({ brief_history: [] }) },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();
    expect(screen.queryByRole("button", { name: /brief history/i })).toBeNull();
  });
});

describe("PrBriefCard controls", () => {
  it("renders no clickable-looking control that does nothing", () => {
    renderCard();
    // `MonoLink` without an href renders an inert button and `Chip` is a
    // `<button>` even when it only shows a number, so a card can grow a control
    // that looks clickable and is not. Every button here must do something.
    const names = screen.getAllByRole("button").map((b) => b.textContent?.trim());
    expect(names).toEqual([brief.pr.regenerate, expect.stringContaining(brief.pr.historyTitle)]);
  });
});
