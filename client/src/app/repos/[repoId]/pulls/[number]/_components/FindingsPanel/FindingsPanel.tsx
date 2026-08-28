/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "@/lib/hooks/reviews";
import { usePullDetail } from "@/lib/hooks";
import { EvalCaseModal } from "@/components/eval-case-modal";
import { KEY_TO_ACTION } from "./constants";
import { evalCaseFromFinding, visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  focusFindingId,
  agentId,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Reveal this finding: focus it, expand it, scroll it into view. */
  focusFindingId?: string | null;
  /** The agent whose run produced these findings — the owner of a minted eval
      case (L06). Absent for a review with no agent, which hides the button. */
  agentId?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  // The file patches a minted eval case is cut from. Already in the cache from
  // the PR page, so this is a read, not a second round trip.
  const { data: pull } = usePullDetail(prId);
  const [minting, setMinting] = React.useState<ReturnType<typeof evalCaseFromFinding>>(null);
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const shown = React.useMemo(() => visibleFindings(findings, hideLow), [findings, hideLow]);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Revealing the finding a severity mark pointed at is a ONE-SHOT command, not
  // an invariant. Held as an invariant it fights the user: `hide low
  // confidence` would spring straight back on every toggle for as long as
  // `?finding=` sat in the URL, and j/k focus would be yanked back to the
  // target. `revealed` disarms it, mirroring the `targetNonce` seam that
  // ReviewRunAccordion uses for exactly this reason.
  const revealed = React.useRef<string | null>(null);
  const [pendingReveal, setPendingReveal] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!focusFindingId || revealed.current === focusFindingId) return;
    revealed.current = focusFindingId;
    setPendingReveal(focusFindingId);
  }, [focusFindingId]);

  React.useEffect(() => {
    if (!pendingReveal) return;
    const idx = shown.findIndex((f) => f.id === pendingReveal);
    if (idx === -1) {
      // Filtered out rather than absent → lift the filter once and let this
      // effect run again against the wider list.
      if (hideLow && findings.some((f) => f.id === pendingReveal)) setHideLow(false);
      else setPendingReveal(null); // not this panel's finding at all
      return;
    }
    setFocusIdx(idx);
    listRef.current
      ?.querySelector(`[data-finding-id="${pendingReveal}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingReveal(null);
  }, [pendingReveal, shown, hideLow, findings]);

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
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0 || f.id === focusFindingId}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
              {...(agentId
                ? {
                    onCreateEvalCase: () =>
                      setMinting(
                        evalCaseFromFinding(
                          f,
                          pull?.files.find((file) => file.path === f.file)?.patch,
                        ),
                      ),
                  }
                : {})}
            />
          ))
        )}
      </div>

      {minting && agentId && (
        <EvalCaseModal
          agentId={agentId}
          evalCase={null}
          initial={minting}
          onClose={() => setMinting(null)}
        />
      )}
    </div>
  );
}
