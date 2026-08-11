/**
 * `toMermaid` as a PURE function.
 *
 * Tested here rather than through the renderer on purpose: mermaid is lazily
 * imported and would need a real DOM and a network-free bundle to exercise, and
 * the property that matters is a property of the SOURCE STRING - every label on
 * this diagram is a symbol name or a path from somebody else's repository.
 */
import { describe, it, expect } from "vitest";
import type { PrBlastRadius } from "@devdigest/shared";
import { GRAPH_MAX_LABEL, GRAPH_MAX_SYMBOLS } from "./constants";
import { toMermaid } from "./toMermaid";

function blast(over: Partial<PrBlastRadius> = {}): PrBlastRadius {
  return {
    changed_symbols: [{ name: "rateLimit", file: "src/middleware/ratelimit.ts", kind: "function" }],
    downstream: [
      {
        symbol: "rateLimit",
        callers: [{ name: "buildServer", file: "src/api/routes/server.ts", line: 30, rank: 0.4 }],
        caller_total: 1,
        endpoints_affected: ["GET /users"],
        endpoints_total: 1,
        crons_affected: [],
        crons_total: 0,
      },
    ],
    summary: "",
    ...over,
  };
}

describe("toMermaid", () => {
  it("emits a flowchart with synthetic node ids and an edge per caller", () => {
    const chart = toMermaid(blast());
    expect(chart.startsWith("flowchart LR")).toBe(true);
    expect(chart).toContain('n0["rateLimit"]');
    expect(chart).toContain("n0 --> n1");
    // Endpoints hang off the symbol with a dotted edge: reachable, not called.
    expect(chart).toContain("-.->");
  });

  it("shortens a deep path to something recognisable", () => {
    expect(toMermaid(blast())).toContain('routes/server.ts');
  });

  it("returns '' when there is nothing to draw, so the caller can say so", () => {
    const chart = toMermaid(
      blast({
        downstream: [
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
      }),
    );
    // Nodes with no edges are a row of disconnected boxes; a sentence says more.
    expect(chart).toBe("");
  });

  it("never lets a hostile symbol name reach the diagram verbatim", () => {
    const hostile = 'A"];click B "https://evil.example" _blank%%';
    const chart = toMermaid(
      blast({
        downstream: [
          {
            symbol: hostile,
            callers: [{ name: "x", file: "src/x.ts", line: 1, rank: 0 }],
            caller_total: 1,
            endpoints_affected: [],
            endpoints_total: 0,
            crons_affected: [],
            crons_total: 0,
          },
        ],
      }),
    );

    expect(chart).not.toContain(hostile);
    expect(chart).not.toContain('"];');
    // The node id is synthetic, so nothing from the data can become syntax.
    expect(chart).toContain("n0[");
  });

  it("strips newlines so one name cannot become two diagram statements", () => {
    const chart = toMermaid(
      blast({
        downstream: [
          {
            symbol: "ok\n  n99[\"injected\"]\n  n0 --> n99",
            callers: [{ name: "x", file: "src/x.ts", line: 1, rank: 0 }],
            caller_total: 1,
            endpoints_affected: [],
            endpoints_total: 0,
            crons_affected: [],
            crons_total: 0,
          },
        ],
      }),
    );
    // The payload survives as inert TEXT inside one label, which is harmless.
    // What must not happen is it becoming its own statement, so the assertion is
    // about the shape of the source: one node per real thing, and no line the
    // data authored.
    const lines = chart.split("\n");
    expect(lines).toHaveLength(4); // header + 2 nodes + 1 edge
    expect(lines.some((l) => l.trim().startsWith("n99"))).toBe(false);
    expect(chart.match(/-->/g)).toHaveLength(1);
  });

  it("clamps a very long label instead of emitting a wall", () => {
    const chart = toMermaid(
      blast({
        downstream: [
          {
            symbol: "x".repeat(500),
            callers: [{ name: "c", file: "src/c.ts", line: 1, rank: 0 }],
            caller_total: 1,
            endpoints_affected: [],
            endpoints_total: 0,
            crons_affected: [],
            crons_total: 0,
          },
        ],
      }),
    );
    const label = chart.match(/n0\["([^"]*)"\]/)![1]!;
    expect(label.length).toBeLessThanOrEqual(GRAPH_MAX_LABEL);
  });

  it("caps how many symbols reach the diagram", () => {
    const many = Array.from({ length: GRAPH_MAX_SYMBOLS + 5 }, (_, i) => ({
      symbol: `sym${i}`,
      callers: [{ name: "c", file: `src/c${i}.ts`, line: 1, rank: 0 }],
      caller_total: 1,
      endpoints_affected: [],
      endpoints_total: 0,
      crons_affected: [],
      crons_total: 0,
    }));
    const chart = toMermaid(blast({ downstream: many }));
    expect(chart).toContain(`sym${GRAPH_MAX_SYMBOLS - 1}`);
    expect(chart).not.toContain(`sym${GRAPH_MAX_SYMBOLS}`);
  });
});
