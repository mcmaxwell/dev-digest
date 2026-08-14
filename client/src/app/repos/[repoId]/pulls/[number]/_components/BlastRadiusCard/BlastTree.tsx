"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { BlastDownstream, ChangedSymbol, PrBlastRadius } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { CallerRow } from "./CallerRow";
import { s, symbolRowStyle } from "./styles";

interface BlastTreeProps {
  blast: PrBlastRadius;
  repoFullName: string | null;
  /** The indexed commit - see the note in CallerRow. */
  indexedSha: string;
  /** The PR head, for linking the CHANGED symbols (which do live in the diff). */
  headSha: string;
}

/**
 * A disclosure row per changed symbol that has callers, and one counted line for
 * the symbols that have none.
 *
 * EVERY SYMBOL IS A COLLAPSIBLE ROW, with the first one open. A blast radius is
 * read top-down - "what did I touch, and does any of it reach far?" - so the
 * scannable list of symbols with their caller counts is the primary view, and
 * the callers themselves are detail you open. Rendering every symbol expanded
 * turns a PR touching a dozen files into pages of scrolling.
 *
 * THE COLLAPSE AT THE BOTTOM SPLITS ON CALLERS, which is what the copy has
 * always said ("no downstream callers"). It cannot also key on endpoints and
 * jobs: those are attributed per FILE, so every one of the forty interfaces
 * declared in a service file inherits that file's cron and would earn its own
 * row showing the identical badge. Their facts are unioned onto the collapsed
 * line instead - shown once, which is the honest rendering of a file-level fact
 * anyway.
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

  // Unioned across the collapsed symbols so a file-level fact appears once, and
  // minus whatever the rows above already show, so no badge is ever duplicated.
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
        <SymbolRow
          key={`${symbol.file}:${symbol.name}:${i}`}
          symbol={symbol}
          down={down}
          // Open the first, which is the highest-impact one: `buildBlast` sorts
          // by caller count. Opening all of them would defeat the disclosure.
          defaultOpen={i === 0}
          repoFullName={repoFullName}
          indexedSha={indexedSha}
          headSha={headSha}
        />
      ))}
      {quiet.length > 0 && (
        <div style={withCallers.length > 0 ? s.quietBlock : undefined}>
          <p style={s.quiet}>{t("noDownstream", { count: quiet.length })}</p>
          <FactRow endpoints={quietEndpoints} crons={quietCrons} />
        </div>
      )}
    </div>
  );
}

function SymbolRow({
  symbol,
  down,
  defaultOpen,
  repoFullName,
  indexedSha,
  headSha,
}: {
  symbol: ChangedSymbol;
  down: BlastDownstream;
  defaultOpen: boolean;
  repoFullName: string | null;
  indexedSha: string;
  headSha: string;
}) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(defaultOpen);
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;
  const callers = down.callers;
  const total = down.caller_total;
  // Functions and methods read as calls; a type or interface never does.
  const callable = symbol.kind === "function" || symbol.kind === "method";
  // The CHANGED file is in the diff, so it links to the PR HEAD and without a
  // line: the declaration's line comes from the index (default branch) and would
  // be wrong on the head. Callers are the opposite case - see CallerRow.
  const blobUrl =
    repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, symbol.file) : null;

  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={symbolRowStyle(open)}
        title={symbol.file}
      >
        <Chevron size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <Icon.Code size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span className="mono" style={s.symbolName}>
          {symbol.name}
          {callable ? "()" : ""}
        </span>
        <span style={s.callerCount}>{t("callerCount", { count: total })}</span>
      </button>

      {open && (
        <div style={s.symbolBody}>
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

          {/* Truncation is stated, never silent: "20 callers" above a list of 20
              out of 137 would be read as the whole set. */}
          {total > callers.length && (
            <p style={s.quiet}>{t("truncated", { shown: callers.length, total })}</p>
          )}

          <FactRow endpoints={down.endpoints_affected} crons={down.crons_affected} />

          <p style={s.declaredIn}>
            {blobUrl ? (
              <a
                className="mono"
                href={blobUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={s.declaredLink}
              >
                {symbol.file}
              </a>
            ) : (
              <span className="mono">{symbol.file}</span>
            )}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Endpoints and jobs as pills. No "ENDPOINTS" / "JOBS" caption: the globe and
 * the clock say it in less space, and these rows are narrow.
 */
function FactRow({ endpoints, crons }: { endpoints: string[]; crons: string[] }) {
  if (endpoints.length === 0 && crons.length === 0) return null;
  return (
    <div style={s.factRow}>
      {endpoints.map((e) => (
        <Badge key={e} mono icon="Globe" color="var(--accent-text)" bg="var(--accent-bg)">
          {e}
        </Badge>
      ))}
      {crons.map((c) => (
        <Badge
          key={c}
          mono
          icon="Clock"
          color="var(--sev-warning, #fbbf24)"
          bg="color-mix(in srgb, var(--sev-warning, #fbbf24) 14%, transparent)"
        >
          {c}
        </Badge>
      ))}
    </div>
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
