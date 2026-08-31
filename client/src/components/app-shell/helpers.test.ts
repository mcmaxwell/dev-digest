import { describe, it, expect } from "vitest";
import { NAV, SETTINGS_ITEM } from "@devdigest/ui";
import { activeKeyFor } from "./helpers";

/**
 * L06 — where the Onboarding Tour sits in the navigation, and what the sidebar
 * highlights, from the spec's own criteria:
 *
 *   AC-2  a repository-scoped destination in the WORKSPACE group, ABOVE
 *         Project Context.
 *   AC-3  exactly one navigation item is highlighted for the tour page, and
 *         nothing is highlighted on the add-repository screen.
 *
 * The active state itself is styling with no accessible attribute behind it,
 * so the seam that can be asserted is the key the shell derives — which is the
 * single input the sidebar highlights from.
 */

const TOUR_PATH = "/repos/9f3c/onboarding";
const ADD_REPO_PATH = "/repos/new";

const workspace = NAV.find((group) => group.section === "WORKSPACE");
const keys = () => workspace!.items.map((i) => i.key);

describe("L06 navigation placement (AC-2)", () => {
  it("offers the Onboarding Tour in the WORKSPACE group", () => {
    expect(workspace).toBeDefined();
    expect(keys()).toContain("onboarding-tour");
  });

  it("places it above Project Context", () => {
    expect(keys().indexOf("onboarding-tour")).toBeLessThan(keys().indexOf("context"));
  });

  it("scopes its destination to the active repository", () => {
    const item = workspace!.items.find((i) => i.key === "onboarding-tour")!;
    expect(item.href).toBe("/repos/:repoId/onboarding");
    expect(item.label).toBe("Onboarding Tour");
  });
});

describe("L06 navigation highlight (AC-3)", () => {
  const allItems = [...NAV.flatMap((g) => g.items), SETTINGS_ITEM];

  it("highlights exactly one item on the Onboarding Tour page", () => {
    const active = activeKeyFor(TOUR_PATH);
    expect(active).toBe("onboarding-tour");
    expect(allItems.filter((i) => i.key === active)).toHaveLength(1);
  });

  it("highlights nothing on the add-repository screen", () => {
    const active = activeKeyFor(ADD_REPO_PATH);
    expect(allItems.filter((i) => i.key === active)).toHaveLength(0);
  });

  it("leaves the neighbouring repository-scoped routes on their own items", () => {
    expect(activeKeyFor("/repos/9f3c/context")).toBe("context");
    expect(activeKeyFor("/repos/9f3c/pulls")).toBe("pulls");
  });
});

/**
 * L07 - Multi-Agent Review's place in the navigation.
 *
 *   AC-1  a repository-scoped destination in the WORKSPACE group. The mockup's
 *         GLOBAL placement is rejected by the spec's Design review: a run
 *         cannot exist without a pull request, and a pull request belongs to a
 *         repository.
 *   AC-2  exactly one item is highlighted on the page - and on all THREE of its
 *         paths, since amendment 01 split the landing page from the configure
 *         screen.
 */
describe("L07 navigation placement (AC-1)", () => {
  it("offers Multi-Agent Review in the WORKSPACE group, scoped to the repository", () => {
    expect(keys()).toContain("multi-agent");
    const item = workspace!.items.find((i) => i.key === "multi-agent")!;
    expect(item.href).toBe("/repos/:repoId/multi-agent");
    expect(item.label).toBe("Multi-Agent Review");
  });
});

describe("L07 navigation highlight (AC-2)", () => {
  const allItems = [...NAV.flatMap((g) => g.items), SETTINGS_ITEM];

  it.each([
    ["/repos/9f3c/multi-agent"],
    ["/repos/9f3c/multi-agent/new"],
    ["/repos/9f3c/multi-agent/7a21"],
  ])("highlights exactly one item on %s", (path) => {
    const active = activeKeyFor(path);
    expect(active).toBe("multi-agent");
    expect(allItems.filter((i) => i.key === active)).toHaveLength(1);
  });

  it("does not steal the highlight from the pull request pages", () => {
    expect(activeKeyFor("/repos/9f3c/pulls/482")).toBe("pulls");
  });
});
