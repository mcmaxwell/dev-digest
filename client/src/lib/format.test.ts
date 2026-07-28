import { describe, it, expect } from "vitest";
import { formatUsd } from "./format";

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
