import { describe, it, expect } from "vitest";
import { formatUsd, formatRunTime } from "./format";

describe("formatUsd", () => {
  it("unknown cost is an em dash, never $0.00", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(undefined)).toBe("—");
  });

  it("zero is a real (free) price", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("sub-dollar amounts keep 2 significant digits", () => {
    expect(formatUsd(0.06)).toBe("$0.06");
    expect(formatUsd(0.014)).toBe("$0.014");
    expect(formatUsd(0.0013)).toBe("$0.0013");
    expect(formatUsd(0.041)).toBe("$0.041");
  });

  it("dollar-plus amounts use 2 decimals", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(1.234)).toBe("$1.23");
    expect(formatUsd(12.5)).toBe("$12.50");
  });
});

describe("formatRunTime", () => {
  const ISO = "2026-08-28T20:55:16.000Z";

  it("drops the seconds the default toLocaleString prints", () => {
    // The finding this replaces: `8/28/2026, 8:55:16 PM`.
    expect(new Date(ISO).toLocaleString()).toMatch(/:\d\d:\d\d/);
    expect(formatRunTime(ISO)).not.toMatch(/:\d\d:\d\d/);
  });

  it("still names the day and the time", () => {
    const out = formatRunTime(ISO);
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(formatRunTime(new Date(ISO))).toBe(formatRunTime(ISO));
  });

  it("hands back an unparseable value rather than showing Invalid Date", () => {
    expect(formatRunTime("not a date")).toBe("not a date");
  });
});
