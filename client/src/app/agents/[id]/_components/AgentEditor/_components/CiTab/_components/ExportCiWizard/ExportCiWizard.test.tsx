import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiBundle } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/ci.json";

const FILES: CiBundle["files"] = [
  {
    path: ".github/workflows/devdigest-review.yml",
    contents: "name: DevDigest Review\n# PLACEHOLDER",
    editable: true,
  },
  {
    path: ".devdigest/agents/security-reviewer.yaml",
    contents: "name: Security Reviewer\nmodel: gpt-4.1",
    editable: true,
  },
  {
    path: ".devdigest/skills/secret-leakage-gate.md",
    contents: "# Secret leakage",
    editable: true,
  },
];

let data: CiBundle | undefined;
let lastInput: unknown;
const mutate = vi.fn((input: unknown, opts?: { onSuccess?: () => void }) => {
  lastInput = input;
  data = { files: FILES };
  opts?.onSuccess?.();
});

// The preview step now also offers Install, so the export mutation is stubbed
// alongside the bundle one; these cases exercise the preview, not the install.
const installMutate = vi.fn();

vi.mock("@/lib/hooks/ci", () => ({
  useCiBundle: () => ({ mutate, data, isPending: false, isError: false }),
  useExportCi: () => ({
    mutate: installMutate,
    data: undefined,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
}));

import { ExportCiWizard } from "./ExportCiWizard";

const AGENT = { id: "a1", name: "Security Reviewer", skill_count: 1 } as Agent;

function renderWizard(agent: Agent = AGENT) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <ExportCiWizard agent={agent} onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

const clickText = (text: string | RegExp) => fireEvent.click(screen.getByText(text));

/** Target step -> configure step. */
function toConfigure() {
  renderWizard();
  clickText("Continue");
}

/** Target step -> configure step -> preview, with the default triggers. */
function toPreview(agent: Agent = AGENT) {
  renderWizard(agent);
  clickText("Continue");
  clickText("Continue");
}

beforeEach(() => {
  data = undefined;
  lastInput = undefined;
});

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

describe("ExportCiWizard - target step", () => {
  it("preselects GitHub Actions (AC-4)", () => {
    renderWizard();
    const gha = screen.getByText("GitHub Actions").closest("button")!;
    expect(gha).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the other three targets as unavailable and unselectable (AC-5)", () => {
    renderWizard();
    for (const name of ["CircleCI", "Jenkins", "Generic CLI"]) {
      expect(screen.getByText(name).closest("button")).toBeDisabled();
    }
    expect(screen.getAllByText("not yet available")).toHaveLength(3);
  });
});

describe("ExportCiWizard - configure step", () => {
  it("preselects opened and synchronize but not reopened (AC-7)", () => {
    toConfigure();
    expect(screen.getByText("Pull request opened").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("New commits pushed").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Pull request reopened").closest("button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("preselects GitHub review as how results are posted (AC-9)", () => {
    toConfigure();
    expect(screen.getByRole("radio", { name: "GitHub review" })).toBeChecked();
  });

  it("cannot continue with every trigger deselected (AC-8)", () => {
    toConfigure();
    clickText("Pull request opened");
    clickText("New commits pushed");
    const cont = screen.getByText("Continue").closest("button")!;
    expect(cont).toBeDisabled();
    fireEvent.click(cont);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("sends the chosen target, triggers and post-as", () => {
    toConfigure();
    clickText("Pull request reopened");
    clickText("Continue");
    expect(lastInput).toEqual({
      target: "gha",
      triggers: ["opened", "synchronize", "reopened"],
      post_as: "github_review",
    });
  });
});

describe("ExportCiWizard - preview step", () => {
  it("lists every generated file by path (AC-20)", () => {
    toPreview();
    // By role: the selected path also appears in the pane header, so plain text
    // matching finds two nodes for whichever file is open.
    for (const f of FILES) {
      expect(screen.getByRole("button", { name: f.path })).toBeInTheDocument();
    }
  });

  it("opens on the workflow file (AC-21)", () => {
    toPreview();
    expect(screen.getByText(/name: DevDigest Review/)).toBeInTheDocument();
  });

  it("switches the displayed contents when another file is picked", () => {
    toPreview();
    clickText(".devdigest/skills/secret-leakage-gate.md");
    expect(screen.getByText("# Secret leakage")).toBeInTheDocument();
  });

  it("offers copy and download for the shown file (AC-22)", () => {
    toPreview();
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Download")).toBeInTheDocument();
  });

  it("copies the shown file's contents and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    toPreview();
    clickText("Copy");
    expect(writeText).toHaveBeenCalledWith(FILES[0]!.contents);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  // Supersedes the placeholder case: the workflow runs a real review now, and
  // the thing a first-time user must be told instead is where it runs.
  it("states the self-hosted runner requirement", () => {
    toPreview();
    expect(screen.getByText(/runs on a self-hosted runner/)).toBeInTheDocument();
  });

  it("explains the shorter bundle when the agent has no skills", () => {
    toPreview({ ...AGENT, skill_count: 0 } as Agent);
    expect(screen.getByText(/no skills attached/)).toBeInTheDocument();
  });

  it("says nothing about it when the agent does have skills", () => {
    toPreview();
    expect(screen.queryByText(/no skills attached/)).not.toBeInTheDocument();
  });
});
