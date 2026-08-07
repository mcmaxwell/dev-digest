/* OrderToggle — segmented control choosing how the Files-changed tab orders the
   diff: reviewer-first (Smart) or exactly as GitHub returned it (Original). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { DIFF_ORDERS, type DiffOrder } from "./constants";
import { s, toggleBtnFor } from "./styles";

const LABEL_KEY: Record<DiffOrder, string> = {
  smart: "smartOrder",
  original: "originalOrder",
};

const PREV_KEYS = ["ArrowLeft", "ArrowUp"];
const NEXT_KEYS = ["ArrowRight", "ArrowDown"];

export function OrderToggle({
  value,
  onChange,
}: {
  value: DiffOrder;
  onChange: (next: DiffOrder) => void;
}) {
  const t = useTranslations("prReview.smartDiff");
  const groupRef = React.useRef<HTMLDivElement>(null);

  // A radiogroup promises arrow-key navigation with a single tab stop. Announcing
  // the role without implementing it leaves a screen-reader user pressing keys
  // that do nothing, so the pattern ships whole or not at all.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = PREV_KEYS.includes(e.key) ? -1 : NEXT_KEYS.includes(e.key) ? 1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const i = DIFF_ORDERS.indexOf(value);
    const next = DIFF_ORDERS[(i + step + DIFF_ORDERS.length) % DIFF_ORDERS.length]!;
    onChange(next);
    // Focus follows checked state, per the ARIA radiogroup pattern.
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-order="${next}"]`)?.focus();
  };

  return (
    // radiogroup, not tablist: both options describe the same panel, they just
    // reorder it — so the choice is a setting, not a navigation target.
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={t("orderLabel")}
      onKeyDown={onKeyDown}
      style={s.toggle}
    >
      {DIFF_ORDERS.map((order) => (
        <button
          key={order}
          type="button"
          role="radio"
          data-order={order}
          aria-checked={value === order}
          // Roving tabindex: the group is one tab stop, arrows move within it.
          tabIndex={value === order ? 0 : -1}
          onClick={() => onChange(order)}
          style={toggleBtnFor(value === order)}
        >
          {t(LABEL_KEY[order])}
        </button>
      ))}
    </div>
  );
}
