/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "@/lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  focusFindingId,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Reveal this finding: focus it, expand it, scroll it into view. */
  focusFindingId?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const shown = React.useMemo(() => visibleFindings(findings, hideLow), [findings, hideLow]);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Reveal the finding a severity mark in the diff pointed at. `hideLow` can
  // filter it out of `shown`, so the filter is lifted rather than leaving the
  // user on a tab that jumped nowhere.
  const focusedIdx = focusFindingId ? shown.findIndex((f) => f.id === focusFindingId) : -1;
  const focusedHidden =
    !!focusFindingId && focusedIdx === -1 && findings.some((f) => f.id === focusFindingId);
  React.useEffect(() => {
    if (focusedHidden) setHideLow(false);
  }, [focusedHidden]);
  React.useEffect(() => {
    if (focusedIdx < 0) return;
    setFocusIdx(focusedIdx);
    listRef.current
      ?.querySelector(`[data-finding-id="${focusFindingId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedIdx, focusFindingId]);

  // Re-clamp focus when the filtered list shrinks (e.g. toggling hideLow) —
  // otherwise focusIdx can point past the end, the focus ring vanishes, and
  // j/k/accept/dismiss silently target nothing.
  React.useEffect(() => {
    setFocusIdx((i) => Math.min(i, Math.max(shown.length - 1, 0)));
  }, [shown.length]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div ref={listRef} style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <div key={f.id} data-finding-id={f.id} style={s.cardAnchor}>
            <FindingCard
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0 || f.id === focusFindingId}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
