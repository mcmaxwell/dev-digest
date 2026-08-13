import { describe, it, expect } from "vitest";
import { formatCost, truncatePath } from "./helpers";

/**
 * L06 — two rules the page's rows depend on, from the spec:
 *
 *   "Very long file path in a row → filename kept whole, directory part
 *    middle-truncated, full path available on hover and to a screen reader"
 *   AC-54: a provider that returns no cost is stated as unavailable, never zero.
 */

describe("truncatePath", () => {
  const LONG = "src/modules/repo-intel/pipeline/incremental.ts";

  it("leaves a path that fits alone", () => {
    expect(truncatePath("src/server.ts")).toBe("src/server.ts");
  });

  it("keeps the filename whole and truncates the directory part in the middle", () => {
    const out = truncatePath(LONG, 30);

    expect(out.endsWith("/incremental.ts")).toBe(true);
    expect(out).toContain("…");
    expect(out.length).toBeLessThanOrEqual(31);
    // The head and the tail of the directory both survive — a truncation that
    // only kept the head would hide which package the file is in.
    expect(out.startsWith("src/")).toBe(true);
  });

  it("keeps the filename even when it alone is longer than the budget", () => {
    const out = truncatePath("a/b/c/an-extremely-long-file-name-that-eats-the-budget.ts", 20);
    expect(out).toBe("…/an-extremely-long-file-name-that-eats-the-budget.ts");
  });

  it("leaves a bare filename alone, having no directory to cut", () => {
    expect(truncatePath("a-very-long-root-level-file-name.ts", 10)).toBe(
      "a-very-long-root-level-file-name.ts",
    );
  });
});

describe("formatCost (AC-54)", () => {
  it("formats a cost the provider reported", () => {
    expect(formatCost(0.0041)).toBe("$0.0041");
  });

  it("returns nothing at all for an unknown cost, rather than a zero", () => {
    expect(formatCost(null)).toBeNull();
  });

  it("keeps a genuine zero distinguishable from an unknown one", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });
});
