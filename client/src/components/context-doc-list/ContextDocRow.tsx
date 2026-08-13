/* ContextDocRow — one document row on a Context tab.

   Promoted to `src/components/` because the agent tab and the skill tab both
   render it; importing it across two sibling `_components/` folders is what
   `pnpm lint` rejects. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon } from "@devdigest/ui";
import { s } from "./styles";

export interface ContextDocRowProps {
  path: string;
  tokens: number;
  /** `missing` = absent from its repository's latest scan; the row stays usable. */
  missing?: boolean;
  attached: boolean;
  /** Absent for an inherited or other-repository row: neither can be toggled. */
  onToggle?: (attach: boolean) => void;
  /**
   * True when this row participates in an ordered list. `onMoveUp` /
   * `onMoveDown` are then absent only at the ends, where the control renders
   * DISABLED rather than vanishing — a control that disappears at the edge is
   * a moving target for a keyboard user.
   */
  reorderable?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Name of the skill an inherited row came from. */
  viaSkill?: string | null;
  /** Attached to a repository other than the active one. */
  notUsedHere?: boolean;
}

export function ContextDocRow({
  path,
  tokens,
  missing,
  attached,
  onToggle,
  reorderable,
  onMoveUp,
  onMoveDown,
  viaSkill,
  notUsedHere,
}: ContextDocRowProps) {
  const t = useTranslations("context");
  const category = path.split("/")[0] ?? "";

  return (
    <div style={s.row(attached, !!notUsedHere)} data-testid="context-doc-row">
      {onToggle ? (
        <Checkbox
          checked={attached}
          onChange={onToggle}
          label={
            <span className="mono" style={s.rowName}>
              {path}
            </span>
          }
        />
      ) : (
        <span className="mono" style={s.rowName} title={path}>
          {path}
        </span>
      )}

      <Badge color="var(--text-muted)">{category}</Badge>
      {missing && <Badge color="var(--warn)">{t("tab.missing")}</Badge>}
      {notUsedHere && <Badge color="var(--text-muted)">{t("tab.notUsedHere")}</Badge>}
      {viaSkill && <Badge color="var(--accent)">{t("tab.viaSkill", { skill: viaSkill })}</Badge>}

      <span style={s.rowSpacer} />
      <Badge color="var(--text-muted)">{t("tab.rowTokens", { tokens })}</Badge>

      {reorderable && (
        <span style={s.arrows}>
          {/* Plain buttons, not the vendored IconBtn: reorder must be operable
              from the keyboard alone, which needs a real `disabled` state and a
              real `aria-label` on each end of the list. */}
          <button
            type="button"
            aria-label={t("tab.moveUp", { path })}
            disabled={!onMoveUp}
            onClick={() => onMoveUp?.()}
            style={s.arrowBtn(!onMoveUp)}
          >
            <Icon.ArrowUp size={14} />
          </button>
          <button
            type="button"
            aria-label={t("tab.moveDown", { path })}
            disabled={!onMoveDown}
            onClick={() => onMoveDown?.()}
            style={s.arrowBtn(!onMoveDown)}
          >
            <Icon.ArrowDown size={14} />
          </button>
        </span>
      )}
    </div>
  );
}
