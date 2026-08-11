"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, MonoLink } from "@devdigest/ui";
import type { BlastDownstream, ChangedSymbol, PrBlastRadius } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { CallerRow } from "./CallerRow";
import { s } from "./styles";

interface BlastTreeProps {
  blast: PrBlastRadius;
  repoFullName: string | null;
  /** The indexed commit - see the note in CallerRow. */
  indexedSha: string;
  /** The PR head, for linking the CHANGED symbols (which do live in the diff). */
  headSha: string;
}

/**
 * One section per changed symbol that HAS downstream, and a single counted line
 * for the ones that do not.
 *
 * The collapse is the point. A PR that touches a page full of interfaces
 * declares dozens of symbols with no call sites, and giving each of them a
 * section turns the card into forty repetitions of "No known callers." with the
 * one symbol that matters buried at the top. The count still says how many there
 * were, so "the index knows nothing calls these" stays distinguishable from
 * "these were never indexed" - it is just said once instead of forty times.
 *
 * THE SPLIT IS ON CALLERS, which is what the copy has always said ("no
 * downstream callers"). It cannot also key on endpoints and jobs: those are
 * attributed per FILE, so every one of the forty interfaces declared in a
 * service file inherits that file's cron and would earn a section showing the
 * identical badge. Endpoints and jobs are not lost - the collapsed symbols'
 * facts are unioned and shown ONCE on the collapsed line, which is the honest
 * rendering of a file-level fact anyway.
 */
export function BlastTree({ blast, repoFullName, indexedSha, headSha }: BlastTreeProps) {
  const t = useTranslations("blast");
  const bySymbol = new Map<string, BlastDownstream>(
    blast.downstream.map((d) => [d.symbol, d]),
  );

  const withCallers: { symbol: ChangedSymbol; down: BlastDownstream }[] = [];
  const quiet: BlastDownstream[] = [];
  for (const symbol of blast.changed_symbols) {
    const down = bySymbol.get(symbol.name);
    if (!down) continue;
    if (down.callers.length > 0) withCallers.push({ symbol, down });
    else quiet.push(down);
  }

  // Unioned across the collapsed symbols, so a file-level fact appears once
  // rather than once per symbol that happens to live in that file - and minus
  // whatever the sections above already show, so the reader never sees the same
  // cron badge twice on one card.
  const shown = new Set(
    withCallers.flatMap(({ down }) => [...down.endpoints_affected, ...down.crons_affected]),
  );
  const quietEndpoints = unique(quiet.flatMap((d) => d.endpoints_affected)).filter(
    (e) => !shown.has(e),
  );
  const quietCrons = unique(quiet.flatMap((d) => d.crons_affected)).filter((c) => !shown.has(c));

  return (
    <div>
      {withCallers.map(({ symbol, down }, i) => (
        <SymbolSection
          key={`${symbol.file}:${symbol.name}:${i}`}
          symbol={symbol}
          down={down}
          repoFullName={repoFullName}
          indexedSha={indexedSha}
          headSha={headSha}
        />
      ))}
      {quiet.length > 0 && (
        <div style={withCallers.length > 0 ? s.quietBlock : undefined}>
          <p style={s.quiet}>{t("noDownstream", { count: quiet.length })}</p>
          <FactRow label={t("endpointsLabel")} values={quietEndpoints} />
          <FactRow label={t("cronsLabel")} values={quietCrons} />
        </div>
      )}
    </div>
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function SymbolSection({
  symbol,
  down,
  repoFullName,
  indexedSha,
  headSha,
}: {
  symbol: ChangedSymbol;
  down: BlastDownstream;
  repoFullName: string | null;
  indexedSha: string;
  headSha: string;
}) {
  const t = useTranslations("blast");
  const callers = down.callers;
  const total = down.caller_total;

  return (
    <section style={s.symbolBlock}>
      <div style={s.symbolHead}>
        <span style={s.symbolName}>{symbol.name}</span>
        {/* The CHANGED file is part of the diff, so it links to the PR HEAD and
            without a line: the declaration's line number comes from the index
            (default branch) and would be wrong on the head. Callers are the
            opposite case - see CallerRow. */}
        {repoFullName && headSha ? (
          <MonoLink href={githubBlobUrl(repoFullName, headSha, symbol.file)}>
            {symbol.file}
          </MonoLink>
        ) : (
          <span style={s.symbolFile}>{symbol.file}</span>
        )}
        {symbol.kind && <span style={s.symbolFile}>{symbol.kind}</span>}
        <span style={s.callerCount}>{t("callerCount", { count: total })}</span>
      </div>

      {callers.length === 0 ? (
        <p style={{ ...s.quiet, marginTop: 8 }}>{t("noCallers")}</p>
      ) : (
        <ul style={s.callerList}>
          {callers.map((caller, i) => (
            <CallerRow
              key={`${caller.file}:${caller.line}:${i}`}
              caller={caller}
              repoFullName={repoFullName}
              indexedSha={indexedSha}
            />
          ))}
        </ul>
      )}

      {/* Truncation is stated, never silent: "20 callers" next to a list of 20
          out of 137 would be read as the whole set. */}
      {total > callers.length && (
        <p style={{ ...s.quiet, marginTop: 6 }}>
          {t("truncated", { shown: callers.length, total })}
        </p>
      )}

      <FactRow label={t("endpointsLabel")} values={down.endpoints_affected} />
      <FactRow label={t("cronsLabel")} values={down.crons_affected} />
    </section>
  );
}

function FactRow({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div style={s.factRow}>
      <span style={s.factLabel}>{label}</span>
      {values.map((value) => (
        <Badge key={value}>{value}</Badge>
      ))}
    </div>
  );
}
