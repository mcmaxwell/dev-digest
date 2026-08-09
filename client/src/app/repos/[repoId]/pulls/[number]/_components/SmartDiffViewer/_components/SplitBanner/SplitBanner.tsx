/* SplitBanner — shown when a PR is large enough that reviewing it in one pass
   is the problem. Names the directories it would fall apart into. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { SmartDiff } from "@devdigest/shared";
import { s } from "../../styles";

export function SplitBanner({ suggestion }: { suggestion: SmartDiff["split_suggestion"] }) {
  const t = useTranslations("prReview.smartDiff");
  if (!suggestion.too_big) return null;

  return (
    <div style={s.banner} role="status">
      <Icon.AlertTriangle size={15} style={s.bannerIcon} />
      <div>
        <div style={s.bannerTitle}>{t("largeTitle", { lines: suggestion.total_lines })}</div>
        {/* The splits are advice, not a plan — with a single directory involved
            the server sends none, and the banner is just the size warning. */}
        {suggestion.proposed_splits.length > 0 && (
          <>
            <div style={s.bannerBody}>{t("largeBody")}</div>
            <ul style={s.bannerList}>
              {suggestion.proposed_splits.map((split) => (
                <li key={split.name}>
                  <span className="mono">{split.name}</span>{" "}
                  <span style={s.bannerSplitFiles}>
                    · {t("filesCount", { count: split.files.length })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
