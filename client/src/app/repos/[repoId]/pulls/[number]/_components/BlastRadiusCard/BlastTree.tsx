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
 * One section per changed symbol: what it is, who calls it, and what sits behind
 * those callers.
 *
 * A symbol with no callers keeps its section and says so. Collapsing it away
 * would make "the index knows nothing calls this" indistinguishable from "this
 * symbol was never indexed", and those need different reactions from a reviewer.
 */
export function BlastTree({ blast, repoFullName, indexedSha, headSha }: BlastTreeProps) {
  const bySymbol = new Map<string, BlastDownstream>(
    blast.downstream.map((d) => [d.symbol, d]),
  );

  return (
    <div>
      {blast.changed_symbols.map((symbol, i) => (
        <SymbolSection
          key={`${symbol.file}:${symbol.name}:${i}`}
          symbol={symbol}
          down={bySymbol.get(symbol.name)}
          repoFullName={repoFullName}
          indexedSha={indexedSha}
          headSha={headSha}
        />
      ))}
    </div>
  );
}

function SymbolSection({
  symbol,
  down,
  repoFullName,
  indexedSha,
  headSha,
}: {
  symbol: ChangedSymbol;
  down: BlastDownstream | undefined;
  repoFullName: string | null;
  indexedSha: string;
  headSha: string;
}) {
  const t = useTranslations("blast");
  const callers = down?.callers ?? [];
  const total = down?.caller_total ?? 0;

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

      <FactRow label={t("endpointsLabel")} values={down?.endpoints_affected ?? []} />
      <FactRow label={t("cronsLabel")} values={down?.crons_affected ?? []} />

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
