import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCaseRecord, EvalSuiteRunRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/eval.json";

const runSuite = vi.fn();

let cases: EvalCaseRecord[] = [];
let runs: EvalSuiteRunRecord[] = [];

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCases: () => ({ data: cases, isLoading: false }),
  useEvalRuns: () => ({ data: runs }),
  useRunEvalSuite: () => ({ mutate: runSuite, isPending: false }),
  useRunEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/components/eval-case-modal", () => ({
  EvalCaseModal: () => <div data-testid="eval-case-modal" />,
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  cases = [];
  runs = [];
});

const AGENT = { id: "a1", name: "Security Reviewer" } as Agent;

function evalCase(over: Partial<EvalCaseRecord>): EvalCaseRecord {
  return {
    id: "c1",
    owner_kind: "agent",
    owner_id: "a1",
    name: "stripe-key-leak",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: null,
    notes: "floor · hardcoded credential",
    expectations: [{ kind: "must_find", file: "src/config.ts", start_line: 12, end_line: 12 }],
    last_run: null,
    ...over,
  } as EvalCaseRecord;
}

function suiteRun(over: Partial<EvalSuiteRunRecord>): EvalSuiteRunRecord {
  return {
    id: "r1",
    owner_kind: "agent",
    owner_id: "a1",
    agent_version: 7,
    model: "m",
    ran_at: "2026-08-27T09:14:00Z",
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    traces_passed: 17,
    traces_total: 20,
    repeats: 1,
    duration_ms: 1000,
    cost_usd: 0.23,
    ...over,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab", () => {
  it("says so plainly when the set has never been run", () => {
    cases = [evalCase({})];
    renderTab();
    expect(screen.getByText(/Not run yet/)).toBeInTheDocument();
  });

  it("leads with the binary pass rate and prints its confidence interval", () => {
    cases = [evalCase({})];
    runs = [suiteRun({})];
    renderTab();
    expect(screen.getByText("17/20")).toBeInTheDocument();
    // The interval is the whole point on a set this size: without it a reader
    // takes a two-point move for progress.
    expect(screen.getByText(/95% CI/)).toBeInTheDocument();
  });

  it("groups the cases by their failure-taxonomy tag", () => {
    cases = [
      evalCase({ id: "c1", name: "stripe-key-leak", notes: "floor · secret" }),
      evalCase({ id: "c2", name: "unused-import", notes: "noise · dismissed" }),
    ];
    renderTab();
    expect(screen.getByRole("list", { name: "floor" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "noise" })).toBeInTheDocument();
  });

  it("shows pass and fail per case", () => {
    cases = [
      evalCase({
        id: "c1",
        last_run: {
          id: "x",
          case_id: "c1",
          case_name: "stripe-key-leak",
          ran_at: "2026-08-27T09:14:00Z",
          actual_output: null,
          pass: true,
          recall: 1,
          precision: 1,
          citation_accuracy: 1,
          duration_ms: 10,
          cost_usd: 0.01,
        },
      }),
    ];
    renderTab();
    expect(screen.getByText(/passed/)).toBeInTheDocument();
  });

  it("cannot start a run when the set is empty", () => {
    renderTab();
    const button = screen.getByRole("button", { name: /Run all evals/ });
    fireEvent.click(button);
    expect(runSuite).not.toHaveBeenCalled();
  });

  it("runs the set once per click", () => {
    cases = [evalCase({})];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /Run all evals/ }));
    expect(runSuite).toHaveBeenCalledTimes(1);
  });
});
