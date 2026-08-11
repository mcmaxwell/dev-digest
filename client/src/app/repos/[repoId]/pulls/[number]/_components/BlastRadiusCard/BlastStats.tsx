"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrBlastRadius } from "@devdigest/shared";
import { STAT_ICONS } from "./constants";
import { s } from "./styles";

/**
 * The four counts, as INLINE text on the card's first row next to the view
 * toggle - not as bordered chips. Four boxes would read as four controls, and
 * none of them is clickable.
 *
 * Endpoints and jobs are counted as SETS across the whole PR, not summed per
 * symbol: they are attributed per file, so two changed symbols in one file share
 * them and adding them up would report an impact twice its real size.
 */
export function BlastStats({ blast }: { blast: PrBlastRadius }) {
  const t = useTranslations("blast");

  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const down of blast.downstream) {
    callers += down.caller_total;
    for (const e of down.endpoints_affected) endpoints.add(e);
    for (const c of down.crons_affected) crons.add(c);
  }

  const stats = [
    // The PRE-CAP total: `changed_symbols` has already been trimmed for display,
    // and a count reporting the trimmed length would present the cap as the fact.
    ["symbols", blast.symbols_total],
    ["callers", callers],
    ["endpoints", endpoints.size],
    ["crons", crons.size],
  ] as const;

  return (
    <div style={s.statRow}>
      {stats.map(([key, value]) => {
        const StatIcon = Icon[STAT_ICONS[key]];
        return (
          <span key={key} style={s.stat}>
            <StatIcon size={13} style={{ color: "var(--text-muted)" }} />
            <span style={s.statValue}>{value}</span>
            <span>{t(`stat.${key}`)}</span>
          </span>
        );
      })}
    </div>
  );
}
