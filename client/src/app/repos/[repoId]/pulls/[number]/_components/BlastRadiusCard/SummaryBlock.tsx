"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { BlastSummaryMeta } from "@devdigest/shared";
import { s } from "./styles";

/**
 * The optional impact summary and its button.
 *
 * The GET never spends a token, so this is the ONLY place in the card that can
 * cost money, and it takes an explicit click every time. The summary the model
 * writes sits directly under the machine-computed lists it was derived from,
 * which is what lets a reader check every claim in it.
 */
export function SummaryBlock({
  summary,
  pending,
  failed,
  onGenerate,
}: {
  summary: BlastSummaryMeta | null;
  pending: boolean;
  failed: boolean;
  onGenerate: () => void;
}) {
  const t = useTranslations("blast");

  return (
    <div style={s.summaryBlock}>
      <div style={s.summaryHead}>
        <span style={s.sectionCaption}>{t("summary.title")}</span>
        {/* Staleness is derived on read against BOTH the PR head and the indexed
            commit, so a summary can go stale without the PR moving at all. */}
        {summary?.stale && (
          <Badge icon="GitCommit" color="var(--sev-warning, #fbbf24)">
            {t("summary.stale")}
          </Badge>
        )}
        <div style={{ marginLeft: "auto" }}>
          <Button kind="ghost" size="sm" icon="Sparkles" loading={pending} onClick={onGenerate}>
            {pending
              ? t("summary.generating")
              : summary
                ? t("summary.regenerate")
                : t("summary.generate")}
          </Button>
        </div>
      </div>

      {summary && <p style={s.summary}>{summary.text}</p>}
      {summary?.stale && <p style={s.summaryFoot}>{t("summary.staleHint")}</p>}
      {summary && (
        <p style={s.summaryFoot}>
          {t("summary.by", { provider: summary.provider, model: summary.model })}
        </p>
      )}
      {failed && <p style={s.summaryFoot}>{t("summary.failed")}</p>}
    </div>
  );
}
