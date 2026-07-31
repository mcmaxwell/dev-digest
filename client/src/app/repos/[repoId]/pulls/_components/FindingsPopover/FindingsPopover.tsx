/* FindingsPopover — hover card for the PR list's FINDINGS column and the PR
   timeline's severity badges. Lazily fetches the PR's reviews on first hover
   and lists findings severity-first, mirroring what the detail page shows —
   all runs by default, one run when `runId` is given (timeline). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  type Severity as UiSeverity,
  type Category,
} from "@devdigest/ui";
import { usePrReviews } from "@/lib/hooks/reviews";

const SEV_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };
const MAX_SHOWN = 4;

const cardStyle: React.CSSProperties = {
  width: 380,
  maxHeight: 340,
  overflowY: "auto",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 14,
  boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  cursor: "default",
  textAlign: "left",
};

export function FindingsPopover({ prId, runId }: { prId: string; runId?: string }) {
  const t = useTranslations("prReview");
  const { data: reviews } = usePrReviews(prId);
  if (!reviews) return null;

  const findings = (runId ? reviews.filter((r) => r.run_id === runId) : reviews)
    .flatMap((r) => r.findings)
    .sort(
      (a, b) =>
        (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) ||
        b.confidence - a.confidence,
    );
  if (findings.length === 0) return null;

  const shown = findings.slice(0, MAX_SHOWN);
  return (
    // paddingTop bridges the gap to the cell so the card survives the mouse
    // crossing from the badges into it (no mouseleave in between).
    <div
      style={{ position: "absolute", top: "100%", left: -8, paddingTop: 8, zIndex: 40 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          <Icon.Info size={12} />
          {t("list.findingsPopover.title", { count: findings.length })}
        </div>
        {shown.map((f) => (
          <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <SeverityBadge severity={f.severity as UiSeverity} compact />
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.title}
              </span>
              <CategoryTag category={f.category as Category} />
            </div>
            <div className="mono" style={{ fontSize: 11, color: "var(--accent-text)" }}>
              {f.file}:{f.start_line}
              {f.end_line > f.start_line ? `-${f.end_line}` : ""}
              <span style={{ color: "var(--text-muted)" }}>
                {" · "}
                {t("list.findingsPopover.conf", { pct: Math.round(f.confidence * 100) })}
              </span>
            </div>
            <div
              style={{
                fontSize: 11.5,
                lineHeight: 1.45,
                color: "var(--text-secondary)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {f.rationale}
            </div>
          </div>
        ))}
        {findings.length > MAX_SHOWN && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            {t("list.findingsPopover.more", { count: findings.length - MAX_SHOWN })}
          </div>
        )}
      </div>
    </div>
  );
}
