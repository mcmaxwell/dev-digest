/* GroupSection — one role's heading (swatch, label, what the role means, file
   count) above its file cards. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { SmartDiffRole } from "@devdigest/shared";
import { ROLE_META } from "../../constants";
import { s } from "../../styles";

export function GroupSection({
  role,
  fileCount,
  children,
}: {
  role: SmartDiffRole;
  fileCount: number;
  children: React.ReactNode;
}) {
  const t = useTranslations("prReview.smartDiff");
  const meta = ROLE_META[role];
  return (
    <section style={s.group} aria-label={t(meta.labelKey)}>
      <header style={s.groupHeader}>
        <span style={{ ...s.groupSwatch, background: meta.color }} />
        <span style={s.groupLabel}>{t(meta.labelKey)}</span>
        {/* The description is what makes the grouping actionable rather than
            decorative: it tells the reviewer how much attention to spend. */}
        <span style={s.groupDesc}>{t(meta.descKey)}</span>
        <span style={s.groupCount}>{t("filesCount", { count: fileCount })}</span>
      </header>
      <div style={s.files}>{children}</div>
    </section>
  );
}
