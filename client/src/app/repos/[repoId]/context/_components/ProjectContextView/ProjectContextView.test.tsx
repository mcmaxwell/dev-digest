import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ProjectDoc, ProjectDocBody, ProjectDocList } from "@/lib/types";
import messages from "../../../../../../../messages/en/context.json";

const DOCS: ProjectDoc[] = [
  { path: "docs/architecture.md", category: "docs", size_bytes: 900, tokens: 225, used_by_agents: 0 },
  { path: "specs/public-api.md", category: "specs", size_bytes: 700, tokens: 175, used_by_agents: 3 },
];

const SCAN: ProjectDocList["scan"] = {
  status: "ok",
  scanned_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  doc_count: 2,
  tokens_total: 400,
  skipped_too_large: 1,
  bounded: 0,
  error: null,
};

let list: { data: ProjectDocList | undefined; isLoading: boolean; isError: boolean };
let doc: {
  data: ProjectDocBody | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
};
const refreshMutate = vi.fn();

vi.mock("@/lib/hooks/project-context", () => ({
  useProjectDocs: () => ({ ...list, refetch: vi.fn() }),
  useProjectDoc: () => ({ ...doc, refetch: vi.fn() }),
  useRefreshProjectDocs: () => ({ mutate: refreshMutate, isPending: false }),
}));

import { ProjectContextView } from "./ProjectContextView";

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ProjectContextView repoId="r1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  refreshMutate.mockClear();
  list = { data: { docs: DOCS, scan: SCAN }, isLoading: false, isError: false };
  doc = { data: undefined, isLoading: false, isError: false, isFetching: false };
});
afterEach(cleanup);

describe("L05 ProjectContextView", () => {
  it("lists documents, refreshes, and reads one — with only refresh in the toolbar", () => {
    doc.data = {
      path: "specs/public-api.md",
      category: "specs",
      size_bytes: 700,
      tokens: 175,
      used_by_agents: 3,
      content: "# Public API\n\nNever expose internal account ids.",
    };
    renderView();

    // Every document is identified by its repo-relative path.
    expect(screen.getByRole("option", { name: "docs/architecture.md" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "specs/public-api.md" })).toBeInTheDocument();

    // Footer: count, token estimate, scan age, and the skipped counter.
    expect(screen.getByText("2 documents · ≈400 tokens · scanned 5m ago")).toBeInTheDocument();
    expect(screen.getByText("1 skipped (over 256 KB)")).toBeInTheDocument();

    // The toolbar carries exactly one action: no create/edit/upload/delete.
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    for (const forbidden of [/new/i, /upload/i, /delete/i, /rename/i, /save/i, /edit/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).not.toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refreshMutate).toHaveBeenCalledWith("r1");

    // Selecting a document renders it read-only, with its usage count.
    fireEvent.click(screen.getByRole("option", { name: "specs/public-api.md" }));
    expect(screen.getByText("Never expose internal account ids.")).toBeInTheDocument();
    expect(screen.getByText("Used by 3 agents")).toBeInTheDocument();
  });

  it("moves selection with the arrow keys, as one tab stop", () => {
    renderView();
    const tree = screen.getByTestId("doc-tree");
    const rows = screen.getAllByRole("option");

    // Roving tabIndex: exactly one row is in the tab order.
    expect(rows.filter((r) => r.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("tabindex", "0");
    expect(rows[0]).toHaveAttribute("aria-posinset", "1");
    expect(rows[0]).toHaveAttribute("aria-setsize", "2");

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "Enter" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
  });

  it("names the clone as the missing prerequisite when there is none", () => {
    list.data = { docs: [], scan: { ...SCAN, status: "not_cloned", doc_count: 0 } };
    renderView();

    expect(screen.getByText("This repository has no clone yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Project documents are read from the repository's clone on disk/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("doc-tree")).not.toBeInTheDocument();
  });

  it("lists the four discovery globs when a completed scan matched nothing", () => {
    list.data = { docs: [], scan: { ...SCAN, doc_count: 0, tokens_total: 0, skipped_too_large: 0 } };
    renderView();

    const empty = screen.getByText(/Discovery looks for Markdown/);
    for (const glob of [
      ".devdigest/**/*.md",
      "docs/**/*.md",
      "specs/**/*.md",
      "insights/**/*.md",
    ]) {
      expect(empty).toHaveTextContent(glob);
    }
  });

  it("shows a per-document read failure with a retry, leaving the tree selection alone", () => {
    doc.isError = true;
    renderView();

    fireEvent.click(screen.getByRole("option", { name: "specs/public-api.md" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t read specs/public-api.md");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    // The tree is still there, and the failed document is still the selection.
    expect(screen.getByRole("option", { name: "specs/public-api.md" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("collapses to tree-then-viewer with a back control below 900px", () => {
    const listeners: Array<() => void> = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        addEventListener: (_: string, fn: () => void) => listeners.push(fn),
        removeEventListener: () => {},
      })),
    );
    doc.data = {
      path: "specs/public-api.md",
      category: "specs",
      size_bytes: 700,
      tokens: 175,
      used_by_agents: 0,
      content: "# Public API",
    };
    renderView();

    // Narrow: the tree is the only pane until something is selected.
    expect(screen.getByTestId("doc-tree")).toBeInTheDocument();
    expect(screen.queryByTestId("doc-markdown")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "specs/public-api.md" }));
    expect(screen.queryByTestId("doc-tree")).not.toBeInTheDocument();
    const back = screen.getByRole("button", { name: "Back to documents" });

    fireEvent.click(back);
    expect(screen.getByTestId("doc-tree")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("holds the open document steady and offers a banner when it changes underneath", () => {
    doc.data = {
      path: "specs/public-api.md",
      category: "specs",
      size_bytes: 700,
      tokens: 175,
      used_by_agents: 0,
      content: "original body",
    };
    const { rerender } = renderView();
    fireEvent.click(screen.getByRole("option", { name: "specs/public-api.md" }));
    expect(screen.getByText("original body")).toBeInTheDocument();

    // A refetch returns different content for the SAME document.
    doc.data = { ...doc.data, content: "rewritten body" };
    rerender(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ProjectContextView repoId="r1" />
      </NextIntlClientProvider>,
    );

    // The text does not swap under the reader.
    expect(screen.getByText("original body")).toBeInTheDocument();
    expect(screen.queryByText("rewritten body")).not.toBeInTheDocument();

    // Adopting it is an explicit act.
    fireEvent.click(screen.getByRole("button", { name: "Load the new version" }));
    expect(screen.getByText("rewritten body")).toBeInTheDocument();
  });
});
