/**
 * OrderToggle — the control that gates which diff renderer the Files-changed
 * tab shows. It announces itself as an ARIA radiogroup, so the keyboard
 * contract that role implies (one tab stop, arrows move the selection) is part
 * of the behaviour under test, not a detail.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import prReview from "../../../../../../../../messages/en/prReview.json";
import { OrderToggle } from "./OrderToggle";
import type { DiffOrder } from "./constants";

afterEach(cleanup);

function renderToggle(value: DiffOrder = "smart") {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview }}>
      <OrderToggle value={value} onChange={onChange} />
    </NextIntlClientProvider>,
  );
  return { onChange };
}

describe("OrderToggle", () => {
  it("exposes both orders as radios with the current one checked", () => {
    renderToggle("smart");
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Smart order", "Original order"]);
    expect(screen.getByRole("radio", { name: "Smart order" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Original order" })).not.toBeChecked();
  });

  it("reports the newly picked order on click", () => {
    const { onChange } = renderToggle("smart");
    fireEvent.click(screen.getByRole("radio", { name: "Original order" }));
    expect(onChange).toHaveBeenCalledWith("original");
  });

  it("keeps a single tab stop (roving tabindex)", () => {
    renderToggle("original");
    expect(screen.getByRole("radio", { name: "Original order" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Smart order" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves the selection with the arrow keys, wrapping at both ends", () => {
    const { onChange } = renderToggle("smart");
    const group = screen.getByRole("radiogroup");

    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("original");

    onChange.mockClear();
    // From the first option, ArrowLeft wraps round to the last.
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("original");
  });

  it("ignores keys that are not part of the radiogroup pattern", () => {
    const { onChange } = renderToggle("smart");
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
