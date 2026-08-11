"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrBlastRadius } from "@devdigest/shared";
import { STAT_ICONS } from "./constants";
import { s } from "./styles";

/**
 * The four counts, in the order the mock puts them.
 *
 * Endpoints and jobs are counted as SETS across the whole PR, not summed per
 * symbol: two changed symbols in one file share the endpoints behind them, and
 * adding those up would report an impact twice the size of the real one.
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
    ["symbols", blast.changed_symbols.length],
    ["callers", callers],
    ["endpoints", endpoints.size],
    ["crons", crons.size],
  ] as const;

  return (
    <div style={s.statRow}>
      {stats.map(([key, value]) => {
        const StatIcon = Icon[STAT_ICONS[key]];
        return (
          <div key={key} style={s.stat}>
            <StatIcon size={13} />
            <span style={s.statValue}>{value}</span>
            <span>{t(`stat.${key}`)}</span>
          </div>
        );
      })}
    </div>
  );
}
