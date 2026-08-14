/**
 * BlastRadiusCard (L04) - what else this PR can reach.
 *
 * Five states, plus the two things a reader could be misled by if they were
 * wrong: an unusable index must never look like an empty blast radius, and a
 * `file:line` must never look clickable when it cannot be clicked.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBlastResponse } from "@devdigest/shared";
import blast from "../../../../../../../../messages/en/blast.json";
import brief from "../../../../../../../../messages/en/brief.json";
import { BlastRadiusCard } from "./BlastRadiusCard";

const usePrBlast = vi.hoisted(() => vi.fn());
const useBlastSummary = vi.hoisted(() => vi.fn());
const useResyncRepoIntel = vi.hoisted(() => vi.fn());

// The mocks FORWARD prId, so a component that stopped passing it (which would
// silently disable the query via `enabled: !!prId`) fails here.
vi.mock("@/lib/hooks/blast", () => ({
  usePrBlast: (prId: string | null) => usePrBlast(prId),
  useBlastSummary: (prId: string | null) => useBlastSummary(prId),
}));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: (repoId: string | null) => useResyncRepoIntel(repoId),
}));

afterEach(cleanup);

const RESPONSE: PrBlastResponse = {
  blast: {
    changed_symbols: [
      { name: "rateLimit", file: "src/middleware/ratelimit.ts", kind: "function" },
      { name: "Lonely", file: "src/config.ts", kind: "function" },
    ],
    downstream: [
      {
        symbol: "rateLimit",
        callers: [{ name: "buildServer", file: "src/server.ts", line: 30, rank: 0.4 }],
        caller_total: 3,
        endpoints_affected: ["GET /users"],
        endpoints_total: 1,
        crons_affected: ["nightly-purge"],
        crons_total: 1,
      },
      {
        symbol: "Lonely",
        callers: [],
        caller_total: 0,
        endpoints_affected: [],
        endpoints_total: 0,
        crons_affected: [],
        crons_total: 0,
      },
    ],
    summary: "",
    symbols_total: 2,
  },
  summary: null,
  index: {
    status: "ok",
    reason: "none",
    ranked: true,
    facts: true,
    graph: true,
    last_indexed_sha: "indexedsha1",
    indexed_at: "2026-08-10T10:00:00.000Z",
  },
  changed_files: 4,
  computed_at: "2026-08-10T11:00:00.000Z",
};

function response(over: Partial<PrBlastResponse> = {}): PrBlastResponse {
  return { ...RESPONSE, ...over };
}

function renderCard(props: Partial<Parameters<typeof BlastRadiusCard>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast, brief }}>
      <BlastRadiusCard
        prId="pr-1"
        repoId="repo-1"
        repoFullName="acme/payments-api"
        headSha="headsha1"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  usePrBlast.mockReturnValue({ data: response(), isLoading: false, isError: false, refetch: vi.fn() });
  useBlastSummary.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
  useResyncRepoIntel.mockReturnValue({ mutate: vi.fn(), isPending: false, isSuccess: false });
});

describe("BlastRadiusCard states", () => {
  it("keeps the heading while loading, so it does not jump when data arrives", () => {
    usePrBlast.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderCard();
    expect(screen.getByText(brief.block.blast)).toBeTruthy();
  });

  it("offers a retry when the read fails", () => {
    const refetch = vi.fn();
    usePrBlast.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderCard();
    expect(screen.getByText(blast.errorTitle)).toBeTruthy();
  });

  it("says an unindexed repo is UNKNOWN, not empty, and offers a working re-analyze", () => {
    const mutate = vi.fn();
    useResyncRepoIntel.mockReturnValue({ mutate, isPending: false, isSuccess: false });
    usePrBlast.mockReturnValue({
      data: response({
        blast: { changed_symbols: [], downstream: [], summary: "", symbols_total: 0 },
        index: { ...RESPONSE.index, status: "degraded", reason: "not_indexed", ranked: false, facts: false, graph: false, last_indexed_sha: "" },
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();

    expect(screen.getByText(blast.notIndexedTitle)).toBeTruthy();
    // Four zeroes here would be a lie; the stat row must not render at all.
    expect(screen.queryByText(blast.stat.symbols)).toBeNull();
    screen.getByRole("button", { name: blast.reindex }).click();
    expect(mutate).toHaveBeenCalled();
  });

  it("explains an empty result and always states the default-branch caveat", () => {
    usePrBlast.mockReturnValue({
      data: response({ blast: { changed_symbols: [], downstream: [], summary: "", symbols_total: 0 } }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();
    expect(screen.getByText(blast.emptyTitle)).toBeTruthy();
    expect(screen.getByText(blast.symbolsCaveat, { exact: false })).toBeTruthy();
  });

  it("renders the populated card: stats, callers, endpoints and jobs", () => {
    renderCard();
    // A function reads as a call; the first symbol is expanded by default.
    expect(screen.getByText("rateLimit()")).toBeTruthy();
    expect(screen.getByText("src/server.ts:30")).toBeTruthy();
    expect(screen.getByText("GET /users")).toBeTruthy();
    expect(screen.getByText("nightly-purge")).toBeTruthy();
  });

  it("is an accordion: the top symbol opens, the rest stay shut", () => {
    usePrBlast.mockReturnValue({
      data: response({
        blast: {
          ...RESPONSE.blast,
          changed_symbols: [
            { name: "rateLimit", file: "src/middleware/ratelimit.ts", kind: "function" },
            { name: "bucketKey", file: "src/middleware/ratelimit.ts", kind: "function" },
          ],
          downstream: [
            RESPONSE.blast.downstream[0]!,
            {
              symbol: "bucketKey",
              callers: [{ name: "rateLimit", file: "src/middleware/ratelimit.ts", line: 9, rank: 0.2 }],
              caller_total: 2,
              endpoints_affected: [],
              endpoints_total: 0,
              crons_affected: [],
              crons_total: 0,
            },
          ],
        },
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();

    const rows = screen.getAllByRole("button", { expanded: false });
    expect(rows.map((r) => r.textContent)).toContain("bucketKey()2 callers");
    // The second symbol's caller is hidden until its row is opened.
    expect(screen.queryByText("src/middleware/ratelimit.ts:9")).toBeNull();
    fireEvent.click(rows.find((r) => r.textContent?.startsWith("bucketKey"))!);
    expect(screen.getByText("src/middleware/ratelimit.ts:9")).toBeTruthy();
  });

  it("collapses symbols with no downstream into ONE counted line", () => {
    renderCard();
    // `Lonely` has no callers, endpoints or jobs. Giving it a section would put
    // a repetition of "No known callers." between the reader and the symbol
    // that matters - and a PR touching a page of interfaces produces dozens.
    expect(screen.queryByText("Lonely")).toBeNull();
    expect(screen.getByText(/1 more changed symbol has no downstream callers/)).toBeTruthy();
    // Still counted in the chip, so the collapse hides noise, not information.
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows a collapsed symbol's endpoints once, not once per symbol", () => {
    // Endpoints and jobs are FILE-level. Forty interfaces declared in one
    // service file all inherit that file's cron, so keying the collapse on them
    // would give each of them a section showing the identical badge. They are
    // unioned onto the collapsed line instead - shown, but once.
    const sameFile = (name: string) => ({
      symbol: name,
      callers: [],
      caller_total: 0,
      endpoints_affected: ["POST /pay"],
      endpoints_total: 1,
      crons_affected: ["0 */4 * * *"],
      crons_total: 1,
    });
    usePrBlast.mockReturnValue({
      data: response({
        blast: {
          changed_symbols: [
            { name: "Draft", file: "src/pay.ts", kind: "interface" },
            { name: "Receipt", file: "src/pay.ts", kind: "interface" },
            { name: "Total", file: "src/pay.ts", kind: "interface" },
          ],
          downstream: [sameFile("Draft"), sameFile("Receipt"), sameFile("Total")],
          summary: "",
          symbols_total: 3,
        },
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();

    expect(screen.getByText(/3 more changed symbols have no downstream callers/)).toBeTruthy();
    // Exactly one badge each, not three.
    expect(screen.getAllByText("POST /pay")).toHaveLength(1);
    expect(screen.getAllByText("0 */4 * * *")).toHaveLength(1);
  });

  it("reports the symbol display cap instead of passing 2 of 90 off as all", () => {
    usePrBlast.mockReturnValue({
      data: response({ blast: { ...RESPONSE.blast, symbols_total: 90 } }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();
    expect(screen.getByText(/Showing 2 of 90 changed symbols/)).toBeTruthy();
    // The chip shows the real total, not the truncated list length.
    expect(screen.getByText("90")).toBeTruthy();
  });

  it("pluralizes the caller count", () => {
    renderCard();
    expect(screen.getByText("3 callers")).toBeTruthy();
    usePrBlast.mockReturnValue({
      data: response({
        blast: {
          ...RESPONSE.blast,
          downstream: [{ ...RESPONSE.blast.downstream[0]!, caller_total: 1 }],
        },
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    cleanup();
    renderCard();
    expect(screen.getByText("1 caller")).toBeTruthy();
  });

  it("states truncation rather than passing 1 of 3 callers off as all of them", () => {
    renderCard();
    expect(screen.getByText("1 of 3 callers shown.")).toBeTruthy();
  });

  it("shows the partial-index banner with the translated reason", () => {
    usePrBlast.mockReturnValue({
      data: response({ index: { ...RESPONSE.index, status: "partial", reason: "no_rank", ranked: false } }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();
    expect(screen.getByText(blast.index.partialTitle, { exact: false })).toBeTruthy();
    expect(screen.getByText(blast.index.no_rank, { exact: false })).toBeTruthy();
  });
});

describe("BlastRadiusCard links", () => {
  it("links a caller to the INDEXED commit, never to the PR head", () => {
    renderCard();
    const link = screen.getByText("src/server.ts:30").closest("a")!;
    // The caller's line number is a fact about the indexed commit; the same line
    // on the PR head may not exist, and the file is not in the diff.
    expect(link.getAttribute("href")).toContain("/blob/indexedsha1/");
    expect(link.getAttribute("href")).not.toContain("headsha1");
    expect(link.getAttribute("href")).toContain("#L30");
  });

  it("links the CHANGED file to the PR head, and without a line", () => {
    renderCard();
    const link = screen.getByText("src/middleware/ratelimit.ts").closest("a")!;
    expect(link.getAttribute("href")).toContain("/blob/headsha1/");
    expect(link.getAttribute("href")).not.toContain("#L");
  });

  it("renders file:line as TEXT, never an inert button, when there is no repo name", () => {
    renderCard({ repoFullName: null });

    expect(screen.getByText("src/server.ts:30")).toBeTruthy();
    // MonoLink without an href renders a <button> with cursor:pointer - something
    // that looks clickable and does nothing. The only buttons on this card are
    // the view toggle and the summary action.
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).not.toContain("src/server.ts:30");
    expect(screen.getByText("src/server.ts:30").closest("a")).toBeNull();
  });

  it("does the same when the index has no commit sha", () => {
    usePrBlast.mockReturnValue({
      data: response({ index: { ...RESPONSE.index, last_indexed_sha: "" } }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();
    expect(screen.getByText("src/server.ts:30").closest("a")).toBeNull();
  });
});

describe("BlastRadiusCard summary", () => {
  it("never generates on render - it takes a click", () => {
    const mutate = vi.fn();
    useBlastSummary.mockReturnValue({ mutate, isPending: false, isError: false });
    renderCard();
    expect(mutate).not.toHaveBeenCalled();
    screen.getByRole("button", { name: blast.summary.generate }).click();
    expect(mutate).toHaveBeenCalled();
  });

  it("marks a summary generated against an older commit or index as out of date", () => {
    usePrBlast.mockReturnValue({
      data: response({
        summary: {
          text: "Touches the rate limiter.",
          provider: "openai",
          model: "gpt-4.1",
          generated_at: "2026-08-09T09:00:00.000Z",
          stale: true,
        },
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();
    expect(screen.getByText("Touches the rate limiter.")).toBeTruthy();
    expect(screen.getByText(blast.summary.stale)).toBeTruthy();
  });
});
