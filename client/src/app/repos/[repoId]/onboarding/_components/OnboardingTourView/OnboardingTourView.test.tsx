import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Onboarding, OnboardingPage, OnboardingSection } from "@/lib/types";
import messages from "../../../../../../../messages/en/onboarding.json";

/**
 * L06 Onboarding Tour page, against the spec's own criteria.
 *
 *   AC-17/18/19  five sections, always, each with its own empty line.
 *   AC-20/21     one diagram, on architecture; an unparseable one leaves prose.
 *   AC-26        every copy control is keyboard-operable and announces itself.
 *   AC-35/36     verified paths link to GitHub pinned to the generation commit.
 *   AC-37/38/39  prerequisite, call-to-action and generating states.
 *   AC-40/41     the header names the index size, the commit and the time.
 *   AC-42        each section collapses independently, expanded by default.
 *   AC-43        the on-page navigation MOVES FOCUS.
 *   AC-44        below 900px it collapses to one jump control.
 *   AC-45/46     Copy as Markdown, and no control producing a shareable URL.
 *   AC-47        staleness stated by commit distance.
 *   AC-50        a regeneration does not blank the tour being read.
 *   AC-53/54     the cost line, in both variants.
 *   AC-58/59     the no-graph marker and one line per degraded reason.
 *   AC-66        model prose renders inert.
 */

const HEAD = "abc1234def567890";
const REPO = "acme/payments-api";

function section(kind: OnboardingSection["kind"], over: Record<string, unknown> = {}): OnboardingSection {
  const base = { title: "", body: "", status: "ok" as const, links: [] };
  const titles: Record<string, string> = {
    architecture: "Architecture overview",
    critical_paths: "Critical paths",
    run_locally: "How to run locally",
    reading_path: "Guided reading path",
    first_tasks: "First tasks",
  };
  const shell = { ...base, title: titles[kind]!, kind };
  return (kind === "architecture"
    ? { ...shell, diagram: null, ...over }
    : { ...shell, items: [], ...over }) as OnboardingSection;
}

const SECTIONS: OnboardingSection[] = [
  section("architecture", {
    body: "Requests enter through [`src/server.ts`](https://github.com/acme/payments-api/blob/abc1234def567890/src/server.ts).",
    links: [{ label: "Entry point", path: "src/server.ts" }],
  }),
  section("critical_paths", {
    items: [
      { path: "src/middleware/auth.ts", reason: "Every request passes through it.", rank_percentile: 0.97 },
    ],
  }),
  section("run_locally", {
    items: [
      { step: 1, command: "pnpm install", source: "package.json" },
      { step: 2, command: "docker compose up -d \\\n  --build postgres", source: "Makefile" },
    ],
  }),
  section("reading_path", {
    items: [{ order: 1, path: "src/server.ts", reason: "Where a request enters." }],
  }),
  section("first_tasks", {
    items: [
      { title: "Rotate the signing key", origin: "todo", path: "src/middleware/auth.ts", line: 42, issue_number: null },
      { title: "Document the headers", origin: "issue", path: null, line: null, issue_number: 311 },
    ],
  }),
];

const TOUR: Onboarding = {
  repo_id: "r1",
  status: "ready",
  degraded_reasons: [],
  head_sha: HEAD,
  index_sha: "index-sha",
  files_indexed: 12_450,
  files_skipped: 12,
  excerpts_used: 15,
  dropped_rows: 0,
  dropped_steps: 0,
  generated_at: "2026-06-03T10:00:00.000Z",
  sections: SECTIONS,
  usage: {
    calls: 1,
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    tokens_in: 24_110,
    tokens_out: 1_830,
    cost_usd: 0.0041,
    attempts: 1,
    duration_ms: 21_400,
  },
};

const PAGE: OnboardingPage = {
  repo_id: "r1",
  clone: "ready",
  tour: TOUR,
  generation: { status: "idle", phase: null, started_at: null },
  current_head_sha: HEAD,
  stale: false,
  commits_behind: null,
};

let page: OnboardingPage;
let query: { data: OnboardingPage | undefined; isLoading: boolean; isError: boolean };
const mutate = vi.fn();
let mutating = false;

vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboarding: () => ({ ...query, refetch: vi.fn() }),
  useGenerateOnboarding: () => ({ mutate, isPending: mutating }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "r1",
    setRepoId: vi.fn(),
    repos: [{ id: "r1", full_name: REPO, default_branch: "main" }],
    activeRepo: { id: "r1", full_name: REPO, default_branch: "main" },
    reposLoaded: true,
  }),
}));

import { OnboardingTourView } from "./OnboardingTourView";

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <OnboardingTourView repoId="r1" />
    </NextIntlClientProvider>,
  );
}

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  mutate.mockClear();
  writeText.mockClear();
  mutating = false;
  page = structuredClone(PAGE);
  query = { data: page, isLoading: false, isError: false };
  // jsdom implements neither of these; both are the environment, not the page.
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("L06 OnboardingTourView — page states", () => {
  it("names the clone as the prerequisite and offers NO generate control (AC-37)", () => {
    page.clone = "absent";
    page.tour = null;
    renderView();

    expect(screen.getByText("This repository has no clone yet")).toBeInTheDocument();
    expect(screen.getByText(/reads the tour's facts straight from the clone/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate/i })).not.toBeInTheDocument();
  });

  it("states what a generation will produce when there is a clone and no tour (AC-38)", () => {
    page.tour = null;
    renderView();

    const cta = screen.getByRole("button", { name: "Generate onboarding tour" });
    const body = screen.getByText(/One structured model call/);
    for (const promised of [
      "architecture overview",
      "critical paths",
      "how to run locally",
      "guided reading path",
      "first tasks",
    ]) {
      expect(body).toHaveTextContent(promised);
    }

    fireEvent.click(cta);
    expect(mutate).toHaveBeenCalledWith("r1");
  });

  it("shows the phase and the five headings while generating with no tour yet (AC-39)", () => {
    page.tour = null;
    page.generation = { status: "running", phase: "model", started_at: "2026-06-03T10:00:00Z" };
    renderView();

    expect(screen.getByRole("status")).toHaveTextContent("Writing the tour (one model call)");
    for (const title of [
      "Architecture overview",
      "Critical paths",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("keeps the previous tour readable while a regeneration runs (AC-50)", () => {
    page.generation = { status: "running", phase: "verifying", started_at: "2026-06-03T10:00:00Z" };
    renderView();

    expect(screen.getByRole("status")).toHaveTextContent("Checking every path against the clone");
    // The old sections are still on screen underneath.
    expect(screen.getByTestId("section-critical_paths")).toBeInTheDocument();
    expect(screen.getByText("Every request passes through it.")).toBeInTheDocument();
  });
});

describe("L06 OnboardingTourView — the header (AC-40, AC-41, AC-45, AC-46, AC-47)", () => {
  it("names the index size, the generation commit and the generation time", () => {
    renderView();

    expect(screen.getByText(/Generated from index of 12,450 files/)).toBeInTheDocument();
    expect(screen.getByText(/12 skipped/)).toBeInTheDocument();
    expect(screen.getByText(`generated at ${HEAD.slice(0, 7)}`)).toBeInTheDocument();
    expect(screen.getByText(/^on /)).toBeInTheDocument();
  });

  it("states how many commits behind the tour is once the head has moved", () => {
    page.stale = true;
    page.commits_behind = 14;
    page.current_head_sha = "9999999aaaa";
    renderView();

    expect(screen.getByText("14 commits behind")).toBeInTheDocument();
  });

  it("names both commits when the distance cannot be counted", () => {
    page.stale = true;
    page.commits_behind = null;
    page.current_head_sha = "9999999aaaa";
    renderView();

    expect(screen.getByText(/the head has moved from abc1234 to 9999999/)).toBeInTheDocument();
  });

  it("copies the whole tour as Markdown, and carries no control producing a shareable URL", async () => {
    renderView();

    const copy = screen.getByRole("button", { name: "Copy as Markdown" });
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledTimes(1);
    await screen.findByRole("button", { name: "Copied" });

    const markdown = writeText.mock.calls[0]![0] as string;
    for (const title of [
      "Architecture overview",
      "Critical paths",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ]) {
      expect(markdown).toContain(title);
    }
    expect(markdown).toContain(HEAD);
    expect(markdown).toContain("pnpm install");

    // AC-46: nothing on this page produces a link someone else could open.
    for (const forbidden of [/share/i, /copy link/i, /public url/i, /publish/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).not.toBeInTheDocument();
    }
  });

  it("offers Regenerate on a healthy tour and Retry on a degraded one (AC-60)", () => {
    const { rerender } = renderView();
    expect(screen.getByRole("button", { name: /Regenerate/ })).toBeInTheDocument();

    page.tour = { ...TOUR, status: "degraded", degraded_reasons: ["model_failed"] };
    query = { data: page, isLoading: false, isError: false };
    rerender(
      <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
        <OnboardingTourView repoId="r1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });
});

describe("L06 OnboardingTourView — cost and degradation (AC-53, AC-54, AC-58, AC-59)", () => {
  it("shows the call count, the token counts and the dollar cost", () => {
    renderView();

    const cost = screen.getByTestId("onboarding-cost");
    expect(cost).toHaveTextContent("1 call · 24,110 in / 1,830 out · $0.0041");
    expect(cost).toHaveTextContent("openrouter/deepseek/deepseek-v4-flash");
    expect(cost).toHaveTextContent("1 attempt");
  });

  it("states that cost is unavailable rather than showing zero", () => {
    page.tour = { ...TOUR, usage: { ...TOUR.usage!, cost_usd: null } };
    renderView();

    const cost = screen.getByTestId("onboarding-cost");
    expect(cost).toHaveTextContent("cost unavailable");
    expect(cost).toHaveTextContent("24,110 in / 1,830 out");
    expect(cost).not.toHaveTextContent("$0.0000");
  });

  it("states each degraded reason exactly once, in text", () => {
    page.tour = {
      ...TOUR,
      status: "degraded",
      degraded_reasons: ["no_index", "issues_unavailable", "no_index"],
    };
    renderView();

    expect(
      screen.getAllByText(/The repository is not indexed, so the tour was built from deterministic facts alone./),
    ).toHaveLength(1);
    expect(screen.getByText(/GitHub issues could not be read/)).toBeInTheDocument();
  });

  it("states a clone that could not be read as its own reason, in words (AC-59, AC-63)", () => {
    // A reason the header has no sentence for renders as its raw key, which is
    // the only way this degradation reaches a user as jargon rather than as an
    // explanation. It is also the one reason that means "no facts at all", so
    // it must not be mistaken for the model failing.
    page.tour = {
      ...TOUR,
      status: "degraded",
      degraded_reasons: ["clone_unavailable"],
    };
    renderView();

    expect(screen.getByText(/The repository's clone could not be read/)).toBeInTheDocument();
    expect(screen.queryByText(/clone_unavailable/)).not.toBeInTheDocument();
    // AC-60: the control on a degraded tour is Retry, whatever degraded it.
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });

  it("marks a section computed without the import graph, in words", () => {
    page.tour = {
      ...TOUR,
      sections: SECTIONS.map((s) =>
        s.kind === "critical_paths" || s.kind === "reading_path" ? { ...s, status: "no_graph" } : s,
      ),
    };
    renderView();

    expect(screen.getAllByText("Computed without the import graph")).toHaveLength(2);
  });

  it("says when a repository was too large for excerpts", () => {
    page.tour = { ...TOUR, excerpts_used: 0, degraded_reasons: ["repo_too_large"], status: "degraded" };
    renderView();

    expect(screen.getByText(/No file excerpts were used/)).toBeInTheDocument();
  });
});

describe("L06 OnboardingTourView — the five sections (AC-17, AC-18, AC-19, AC-42)", () => {
  it("renders all five in the fixed order", () => {
    renderView();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Architecture overview",
      "Critical paths",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ]);
  });

  it("renders an empty section with its own line naming what was looked for", () => {
    page.tour = {
      ...TOUR,
      sections: SECTIONS.map((s) =>
        s.kind === "run_locally" || s.kind === "first_tasks"
          ? ({ ...s, items: [], body: "", status: "empty" } as OnboardingSection)
          : s,
      ),
    };
    renderView();

    expect(screen.getByTestId("section-run_locally")).toHaveTextContent(
      "No runnable commands were found in package.json scripts, Makefile, Justfile or Taskfile.yml.",
    );
    const tasks = screen.getByTestId("section-first_tasks");
    expect(tasks).toHaveTextContent("TODO and FIXME markers");
    expect(tasks).toHaveTextContent("good first issue");
  });

  it("collapses one card without touching the other four, and starts expanded", () => {
    renderView();

    const cards = screen.getAllByRole("button", { name: /^(Collapse|Expand) section$/ });
    expect(cards).toHaveLength(5);
    expect(cards.every((c) => c.getAttribute("aria-expanded") === "true")).toBe(true);

    const critical = within(screen.getByTestId("section-critical_paths")).getByRole("button", {
      name: "Collapse section",
    });
    fireEvent.click(critical);

    expect(critical).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Every request passes through it.")).not.toBeInTheDocument();
    // The other four are untouched.
    expect(screen.getByText("Where a request enters.")).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", { name: /^(Collapse|Expand) section$/ })
        .filter((c) => c.getAttribute("aria-expanded") === "true"),
    ).toHaveLength(4);
  });
});

describe("L06 OnboardingTourView — rows and links (AC-24, AC-26, AC-35, AC-36)", () => {
  it("links every path to the GitHub blob pinned to the generation commit, and nowhere in-product", () => {
    const { container } = renderView();

    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^https:\/\/github\.com\//);
      expect(href).toContain(`/blob/${HEAD}/`);
    }
    // A first task cites its line, so the link opens at it.
    expect(hrefs).toContain(
      `https://github.com/${REPO}/blob/${HEAD}/src/middleware/auth.ts#L42`,
    );
    // The full path stays available to a screen reader even when truncated.
    expect(
      screen.getAllByRole("link", { name: "Open src/middleware/auth.ts on GitHub" }).length,
    ).toBeGreaterThan(0);
  });

  it("shows every run step with its ordinal, its command and the file it came from", () => {
    renderView();

    const run = within(screen.getByTestId("section-run_locally"));
    expect(run.getByText("1.")).toBeInTheDocument();
    expect(run.getByText("pnpm install")).toBeInTheDocument();
    expect(run.getByText("2.")).toBeInTheDocument();
    expect(run.getAllByText("from").length).toBe(2);
    expect(run.getByRole("link", { name: "Open package.json on GitHub" })).toBeInTheDocument();
  });

  it("copies a multi-line command whole from the keyboard alone, and announces the copy", async () => {
    renderView();

    const buttons = within(screen.getByTestId("section-run_locally")).getAllByRole("button", {
      name: "Copy command",
    });
    const second = buttons[1]!;

    // Keyboard-operable for free because it is a real <button>: focusable, and
    // Enter/Space activate it. `detail: 0` is what a browser sets on a
    // keyboard-originated click; this repo has no `@testing-library/user-event`.
    expect(second.tagName).toBe("BUTTON");
    second.focus();
    expect(second).toHaveFocus();
    fireEvent.click(second, { detail: 0 });

    expect(writeText).toHaveBeenCalledWith("docker compose up -d \\\n  --build postgres");

    // The confirmation replaces this control's label and nobody else's.
    await within(screen.getByTestId("section-run_locally")).findByRole("button", {
      name: "Command copied",
    });
    expect(
      within(screen.getByTestId("section-run_locally")).getAllByRole("button", {
        name: "Copy command",
      }),
    ).toHaveLength(1);
  });

  it("confirms a copy visibly and to assistive technology", async () => {
    renderView();

    const copy = screen.getByRole("button", { name: "Copy as Markdown" });
    fireEvent.click(copy, { detail: 0 });
    // The clipboard write is async; the confirmation lands with it.
    await screen.findByRole("button", { name: "Copied" });

    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(document.body).toHaveTextContent("Copied");
  });
});

describe("L06 OnboardingTourView — on-page navigation (AC-43, AC-44)", () => {
  it("moves FOCUS to the section, not only the scroll position", () => {
    renderView();

    const nav = within(screen.getByRole("navigation", { name: "On this page" }));
    fireEvent.click(nav.getByRole("button", { name: "First tasks" }));

    expect(document.activeElement).toBe(document.getElementById("onboarding-section-first_tasks"));
    expect(document.activeElement).toHaveTextContent("First tasks");
  });

  it("offers all five sections in the navigation, including the empty ones", () => {
    page.tour = {
      ...TOUR,
      sections: SECTIONS.map((s) => ({ ...s, items: [], body: "", status: "empty" }) as OnboardingSection),
    };
    renderView();

    const nav = within(screen.getByRole("navigation", { name: "On this page" }));
    for (const title of [
      "Architecture overview",
      "Critical paths",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ]) {
      expect(nav.getByRole("button", { name: title })).toBeInTheDocument();
    }
  });

  it("collapses to a single jump control below 900px", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((q: string) => ({
        matches: true,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    renderView();

    expect(screen.queryByRole("navigation", { name: "On this page" })).not.toBeInTheDocument();
    const jump = screen.getByLabelText("Jump to section");
    expect(jump.tagName).toBe("SELECT");

    fireEvent.change(jump, { target: { value: "reading_path" } });
    expect(document.activeElement).toBe(document.getElementById("onboarding-section-reading_path"));
  });
});

describe("L06 OnboardingTourView — untrusted model output (AC-21, AC-66)", () => {
  it("renders embedded HTML and script as text, and emits no non-http(s) link", () => {
    page.tour = {
      ...TOUR,
      sections: SECTIONS.map((s) =>
        s.kind === "architecture"
          ? ({
              ...s,
              body: [
                "<script>alert(1)</script>",
                '<img src=x onerror="alert(1)">',
                "[click me](javascript:alert(1))",
                "[home](https://github.com/acme/payments-api)",
              ].join("\n\n"),
            } as OnboardingSection)
          : s,
      ),
    };
    const { container } = renderView();

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();

    for (const a of container.querySelectorAll("a")) {
      const href = a.getAttribute("href") ?? "";
      expect(href).not.toMatch(/^javascript:/i);
      if (href) expect(href).toMatch(/^https?:\/\//);
    }
  });

  it("leaves the prose standing when the diagram does not render, with no blank card", () => {
    page.tour = {
      ...TOUR,
      sections: SECTIONS.map((s) =>
        s.kind === "architecture"
          ? ({ ...s, body: "A gateway in front of two services.", diagram: "not a diagram at all" } as OnboardingSection)
          : s,
      ),
    };
    const { container } = renderView();

    expect(screen.getByText("A gateway in front of two services.")).toBeInTheDocument();
    expect(container.querySelector("svg.mermaid")).toBeNull();
    expect(screen.getByTestId("section-architecture")).toBeInTheDocument();
  });
});
