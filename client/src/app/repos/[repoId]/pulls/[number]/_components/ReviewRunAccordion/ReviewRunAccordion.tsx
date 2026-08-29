/* ReviewRunAccordion — one collapsible review RUN (a single agent's pass over
   the PR). Header shows agent + verdict + counts + score + when it ran; the
   body holds that run's VerdictBanner summary and its own FindingsPanel. A PR
   can have many runs (different agents / re-runs over time) — each is separate
   and collapsible so older runs don't bury the latest. */
"use client";

import React from "react";
import { Icon, Badge } from "@devdigest/ui";
import type { ReviewRecord, Verdict } from "@devdigest/shared";
import { FindingsPanel } from "../FindingsPanel";
import { VerdictBanner } from "../VerdictBanner";
import { useDeleteReview } from "@/lib/hooks/reviews";

const VERDICT_COLOR: Record<string, string> = {
  request_changes: "var(--crit)",
  comment: "var(--warn)",
  approve: "var(--ok)",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function ReviewRunAccordion({
  review,
  prId,
  defaultOpen = false,
  repoFullName,
  headSha,
  targetRunId = null,
  targetNonce = 0,
  focusFindingId = null,
}: {
  review: ReviewRecord;
  prId: string;
  defaultOpen?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** When this matches review.run_id, the accordion opens and scrolls into view
   *  (driven from the Timeline: clicking an agent name navigates here). */
  targetRunId?: string | null;
  targetNonce?: number;
  /** When this run owns the finding, the accordion opens and scrolls to it. */
  focusFindingId?: string | null;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (review.run_id && review.run_id === targetRunId) {
      setOpen(true);
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
     
  }, [targetRunId, targetNonce, review.run_id]);
  const del = useDeleteReview(prId);
  const findings = review.findings;

  // A severity mark in the diff names a finding, not a run — so each accordion
  // decides for itself whether it owns it. Keying off the finding rather than
  // `run_id` also works for a review that predates run tracking (run_id null),
  // which the targetRunId path above cannot match.
  const ownsFocused = !!focusFindingId && findings.some((f) => f.id === focusFindingId);
  React.useEffect(() => {
    if (ownsFocused) setOpen(true);
  }, [ownsFocused, focusFindingId]);
  const blockers = findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;
  // Severity breakdown for the header, e.g. "2 critical · 1 warning" (zero
  // counts omitted; empty string when the review has no findings).
  const severitySummary = (["CRITICAL", "WARNING", "SUGGESTION"] as const)
    .map((sev) => [sev, findings.filter((f) => f.severity === sev).length] as const)
    .filter(([, count]) => count > 0)
    .map(([sev, count]) => `${count} ${sev.toLowerCase()}`)
    .join(" · ");
  const verdictColor = review.verdict ? VERDICT_COLOR[review.verdict] ?? "var(--text-muted)" : "var(--text-muted)";

  return (
    <div
      ref={rootRef}
      id={review.run_id ? `review-run-${review.run_id}` : undefined}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-surface)",
        marginBottom: 14,
        overflow: "hidden",
        scrollMarginTop: 16,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 16px",
          cursor: "pointer",
          color: "var(--text-primary)",
        }}
      >
        <Icon.Cpu size={15} style={{ color: "var(--text-muted)" }} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{review.agent_name ?? "Agent"}</span>
        {review.verdict && (
          <Badge color={verdictColor} bg="transparent">
            {review.verdict.replace("_", " ")}
          </Badge>
        )}
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          {findings.length} finding{findings.length === 1 ? "" : "s"}
          {severitySummary ? ` · ${severitySummary}` : ""}
          {blockers > 0 ? ` · ${blockers} blocker${blockers === 1 ? "" : "s"}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {review.score != null && (
          <Badge mono color="var(--text-secondary)">
            {review.score}
          </Badge>
        )}
        <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {formatWhen(review.created_at)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete this "${review.agent_name ?? "agent"}" review run and its findings?`)) {
              del.mutate(review.id);
            }
          }}
          disabled={del.isPending}
          title="Delete this review run"
          aria-label="Delete this review run"
          style={{
            background: "none",
            border: "none",
            cursor: del.isPending ? "not-allowed" : "pointer",
            color: "var(--text-muted)",
            display: "inline-flex",
            padding: 4,
          }}
        >
          <Icon.Trash size={14} style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined} />
        </button>
        <Icon.ChevronDown
          size={16}
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", color: "var(--text-muted)" }}
        />
      </div>

      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          {review.verdict && (
            <div style={{ marginBottom: 16 }}>
              <VerdictBanner
                verdict={review.verdict as Verdict}
                summary={review.summary}
                score={review.score}
                findingsCount={findings.length}
                blockers={blockers}
                agentName={review.agent_name}
              />
            </div>
          )}
          <FindingsPanel
            findings={findings}
            prId={prId}
            repoFullName={repoFullName}
            headSha={headSha}
            focusFindingId={ownsFocused ? focusFindingId : null}
            agentId={review.agent_id}
          />
        </div>
      )}
    </div>
  );
}

export default ReviewRunAccordion;
