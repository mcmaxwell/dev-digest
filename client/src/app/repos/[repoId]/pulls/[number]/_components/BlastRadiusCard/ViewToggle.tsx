"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { BLAST_VIEWS, type BlastView } from "./constants";
import { s, toggleBtnFor } from "./styles";

const PREV_KEYS = ["ArrowLeft", "ArrowUp"];
const NEXT_KEYS = ["ArrowRight", "ArrowDown"];

/**
 * Tree or graph - two renderings of the same data, so a radiogroup rather than a
 * tablist: the choice is a setting, not a navigation target.
 *
 * The arrow-key handling is not decoration. Announcing `role="radiogroup"`
 * promises arrow navigation with a single tab stop; announcing it without
 * implementing it leaves a screen-reader user pressing keys that do nothing.
 * (`OrderToggle` in the ancestor `_components/` implements the same pattern for
 * the diff order. A THIRD copy should become one shared segmented control.)
 */
export function ViewToggle({
  value,
  onChange,
}: {
  value: BlastView;
  onChange: (next: BlastView) => void;
}) {
  const t = useTranslations("blast");
  const groupRef = React.useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = PREV_KEYS.includes(e.key) ? -1 : NEXT_KEYS.includes(e.key) ? 1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const i = BLAST_VIEWS.indexOf(value);
    const next = BLAST_VIEWS[(i + step + BLAST_VIEWS.length) % BLAST_VIEWS.length]!;
    onChange(next);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)?.focus();
  };

  return (
    <div ref={groupRef} role="radiogroup" aria-label={t("view.label")} onKeyDown={onKeyDown} style={s.toggle}>
      {BLAST_VIEWS.map((view) => (
        <button
          key={view}
          type="button"
          role="radio"
          data-view={view}
          aria-checked={value === view}
          // Roving tabindex: the group is one tab stop, arrows move within it.
          tabIndex={value === view ? 0 : -1}
          onClick={() => onChange(view)}
          style={toggleBtnFor(value === view)}
        >
          {t(`view.${view}`)}
        </button>
      ))}
    </div>
  );
}
