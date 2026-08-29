/**
 * DiffViewer — the plain (non-smart) Files-changed list.
 *
 * The one behaviour worth a test of its own is the `?file=` jump L05 added: a
 * review-focus click on the Overview tab must land on that file expanded,
 * whatever the size heuristic would have decided, and in EITHER diff order.
 * The smart order's half of the same property lives in
 * `SmartDiffViewer.test.tsx`.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@/lib/types";
import shell from "../../../../messages/en/shell.json";
import { DiffViewer } from "./DiffViewer";

// jsdom implements neither; the focused file scrolls itself into view.
const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

afterEach(cleanup);

/** Big enough to sit above AUTO_EXPAND_MAX_LINES, so it starts collapsed. */
const HUGE: PrFile = {
  path: "package-lock.json",
  additions: 900,
  deletions: 400,
  patch: "@@ -1,2 +1,2 @@\n-old\n+lockfile-body\n",
};

const SMALL: PrFile = {
  path: "src/config.ts",
  additions: 2,
  deletions: 0,
  patch: "@@ -10,3 +10,4 @@\n export const config = {\n+  windowMs: 60000,\n",
};

function renderViewer(props: Partial<React.ComponentProps<typeof DiffViewer>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell }}>
      <DiffViewer files={[HUGE, SMALL]} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("DiffViewer", () => {
  it("leaves a large file collapsed when nothing asks for it", () => {
    renderViewer();
    expect(screen.queryByText("lockfile-body")).toBeNull();
    expect(screen.getByText(/windowMs/)).toBeTruthy();
  });

  it("opens and scrolls to the file named by ?file=, overriding the size heuristic", async () => {
    renderViewer({ focusFile: "package-lock.json" });
    expect(screen.getByText("lockfile-body")).toBeTruthy();
    // The scroll waits a frame for the body to mount, so it lands one
    // `requestAnimationFrame` after render rather than in this tick.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("changes nothing when ?file= names a path this PR does not contain", async () => {
    scrollIntoView.mockClear();
    renderViewer({ focusFile: "src/does-not-exist.ts" });
    expect(screen.queryByText("lockfile-body")).toBeNull();
    // Proving an ABSENCE needs a window in which it would have appeared: the
    // scroll above lands a frame late, so asserting in this tick would pass
    // against a broken implementation too.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
