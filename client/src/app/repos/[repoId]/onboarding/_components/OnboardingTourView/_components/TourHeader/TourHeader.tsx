/* TourHeader — the tour's provenance, its cost, and its two controls.

   The header answers the three questions a reader has before trusting any of
   the five sections: what was it generated FROM (an index of N files), WHEN and
   at which commit, and how far the code has moved since. Then it says what the
   generation cost, because the user is the one paying for it.

   It carries Regenerate (or Retry, when the tour is degraded) and Copy as
   Markdown, and NOTHING ELSE — in particular no share control. DevDigest is
   local-first with no authentication and no public URLs, so a "share link"
   would work only on the author's laptop. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { Onboarding, OnboardingPage } from "@/lib/types";
import { CopyButton } from "../CopyButton";
import { formatCost, formatCount, formatTime, shortSha, tourToMarkdown } from "../../helpers";
import { s } from "../../styles";

interface TourHeaderProps {
  page: OnboardingPage;
  tour: Onboarding;
  repoFullName: string;
  onRegenerate: () => void;
  regenerating: boolean;
}

export function TourHeader({
  page,
  tour,
  repoFullName,
  onRegenerate,
  regenerating,
}: TourHeaderProps) {
  const t = useTranslations("onboarding");
  const degraded = tour.status === "degraded";

  return (
    <header style={s.header}>
      <div style={s.headerTop}>
        <span style={s.headerTitle}>{t("title")}</span>
        <CopyButton
          value={tourToMarkdown(tour, repoFullName)}
          label={t("copyMarkdown")}
          copiedLabel={t("copied")}
        />
        <Button
          kind="primary"
          size="sm"
          icon="RefreshCw"
          loading={regenerating}
          onClick={onRegenerate}
        >
          {regenerating ? t("regenerating") : degraded ? t("retry") : t("regenerate")}
        </Button>
      </div>

      <div style={s.meta}>
        <span>
          {t("header.indexedFiles", { count: formatCount(tour.files_indexed) })}
          {tour.files_skipped > 0 &&
            ` (${t("header.skippedFiles", { count: formatCount(tour.files_skipped) })})`}
        </span>
        <span style={s.metaSep}>·</span>
        <span className="mono">{t("header.generatedAt", { sha: shortSha(tour.head_sha) })}</span>
        <span style={s.metaSep}>·</span>
        <span>{t("header.generatedTime", { time: formatTime(tour.generated_at) })}</span>
        {page.stale && (
          <>
            <span style={s.metaSep}>·</span>
            <span style={{ color: "var(--warn)" }}>
              {page.commits_behind != null
                ? t("header.commitsBehind", { count: page.commits_behind })
                : t("header.headMoved", {
                    tourSha: shortSha(tour.head_sha),
                    currentSha: shortSha(page.current_head_sha ?? ""),
                  })}
            </span>
          </>
        )}
      </div>

      <CostLine tour={tour} />

      {tour.excerpts_used === 0 && tour.degraded_reasons.includes("repo_too_large") && (
        <div style={s.reason}>
          <Icon.Info size={13} />
          <span>{t("header.noExcerpts")}</span>
        </div>
      )}

      {(tour.dropped_rows > 0 || tour.dropped_steps > 0) && (
        <div style={s.reason}>
          <Icon.Shield size={13} />
          <span>
            {t("header.dropped", { rows: tour.dropped_rows, steps: tour.dropped_steps })}
          </span>
        </div>
      )}

      {/* Each reason exactly once — the service de-duplicates, and so does this. */}
      {[...new Set(tour.degraded_reasons)].map((reason) => (
        <div key={reason} style={s.reason}>
          <Icon.AlertTriangle size={13} style={{ color: "var(--warn)" }} />
          <span>{t(`degraded.reason.${reason}`)}</span>
        </div>
      ))}
    </header>
  );
}

/**
 * "1 call · 24,110 in / 1,830 out · $0.0041".
 *
 * A provider that returns no cost gets "cost unavailable", never `$0.0000` —
 * showing zero for an unknown cost is a lie the user cannot detect.
 */
function CostLine({ tour }: { tour: Onboarding }) {
  const t = useTranslations("onboarding");
  const { usage } = tour;
  if (!usage) return <div style={s.cost}>{t("cost.none")}</div>;

  const cost = formatCost(usage.cost_usd);
  return (
    <div style={s.cost} data-testid="onboarding-cost">
      {t("cost.line", {
        calls: usage.calls,
        tokensIn: usage.tokens_in != null ? formatCount(usage.tokens_in) : "—",
        tokensOut: usage.tokens_out != null ? formatCount(usage.tokens_out) : "—",
        cost: cost ?? t("cost.unavailable"),
      })}
      {" · "}
      <span className="mono">{`${usage.provider}/${usage.model}`}</span>
      {" · "}
      {t("cost.attempts", { count: usage.attempts })}
    </div>
  );
}
