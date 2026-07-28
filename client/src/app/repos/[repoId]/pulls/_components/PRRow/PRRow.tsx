/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore, SeverityBadge } from "@devdigest/ui";
import type { PrMeta, Severity } from "@/lib/types";
import { formatUsd } from "@/lib/format";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";
import { FindingsPopover } from "../FindingsPopover";

/** Latest-review severity breakdown in display order; zero counts are omitted. */
const SEVERITY_CELLS: { severity: Severity; key: "critical" | "warning" | "suggestion" }[] = [
  { severity: "CRITICAL", key: "critical" },
  { severity: "WARNING", key: "warning" },
  { severity: "SUGGESTION", key: "suggestion" },
];

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const [findingsHover, setFindingsHover] = React.useState(false);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  const totalFindings = pr.findings
    ? pr.findings.critical + pr.findings.warning + pr.findings.suggestion
    : 0;
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div
        style={{ ...s.findingsCell, position: "relative" }}
        onMouseEnter={() => setFindingsHover(true)}
        onMouseLeave={() => setFindingsHover(false)}
      >
        {pr.findings ? (
          totalFindings > 0 ? (
            SEVERITY_CELLS.filter(({ key }) => pr.findings![key] > 0).map(({ severity, key }) => (
              <SeverityBadge key={key} severity={severity} compact count={pr.findings![key]} />
            ))
          ) : (
            <span style={s.muted}>0</span>
          )
        ) : (
          <span style={s.muted}>—</span>
        )}
        {findingsHover && totalFindings > 0 && pr.id && <FindingsPopover prId={pr.id} />}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div className="mono tnum" style={{ ...s.costCell, ...(pr.total_cost_usd == null ? s.muted : {}) }}>
        {formatUsd(pr.total_cost_usd)}
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
