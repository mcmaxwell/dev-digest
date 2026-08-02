import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

let mockRunning = false;
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: mockRunning }),
}));

import { RunStatus } from "./RunStatus";

afterEach(() => {
  cleanup();
  mockRunning = false;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RunStatus (smoke)", () => {
  it("renders nothing when there are no run ids", () => {
    const { container } = renderWithIntl(<RunStatus runIds={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("RunStatus — onDone invalidation storm", () => {
  // Regression for: wasRunning.current stayed true after firing onDone once,
  // so a parent re-render that hands RunStatus a fresh `onDone` identity (an
  // unmemoized inline arrow, as PrDetailPage used to pass) re-fired the effect
  // and called onDone again — which itself triggers the parent re-render that
  // produces the next fresh identity, and so on.
  it("calls onDone exactly once per run, even across parent re-renders with a new onDone identity", () => {
    const onDone = vi.fn();
    // Mimics a parent that hands down a fresh inline callback every render.
    function Harness() {
      return <RunStatus runIds={["r1"]} onDone={() => onDone()} />;
    }

    mockRunning = true;
    const { rerender } = renderWithIntl(<Harness />);

    mockRunning = false;
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <Harness />
      </NextIntlClientProvider>,
    );
    expect(onDone).toHaveBeenCalledTimes(1);

    // Further re-renders (still "done", fresh onDone each time) must not
    // re-trigger it.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <Harness />
      </NextIntlClientProvider>,
    );
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <Harness />
      </NextIntlClientProvider>,
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
