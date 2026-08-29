/* EvalsTab — the agent's regression harness: the case set, its last run's
   metrics, and the buttons that mint, edit and execute cases.

   The binary pass rate leads and the three ratios sit underneath it, because a
   set this size resolves nothing finer than one case: the 95% interval printed
   under the pass rate is there so a two-point move is not read as progress. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Icon, IconBtn, MetricCard } from "@devdigest/ui";
import type { Agent, EvalCaseRecord } from "@devdigest/shared";
import { evalF1, evalWilson } from "@devdigest/shared/contracts/eval-math";
import {
  useDeleteEvalCase,
  useEvalCases,
  useEvalRuns,
  useRunEvalCase,
  useRunEvalSuite,
} from "@/lib/hooks/eval";
import { EvalCaseModal } from "@/components/eval-case-modal";
import { s } from "./styles";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The taxonomy tag a seeded case carries in `notes`, e.g. "floor · secret".
 * Returns null when there is no usable tag, so the CALLER supplies the
 * translated fallback rather than this helper inventing an English one.
 */
function bucketOf(c: EvalCaseRecord): string | null {
  const head = (c.notes ?? "").split("·")[0]?.trim();
  return head && head.length <= 20 ? head : null;
}

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const { data: cases, isLoading } = useEvalCases(agent.id);
  const { data: runs } = useEvalRuns(agent.id);
  const runSuite = useRunEvalSuite(agent.id);
  const runCase = useRunEvalCase(agent.id);
  const removeCase = useDeleteEvalCase(agent.id);
  const [editing, setEditing] = React.useState<EvalCaseRecord | "new" | null>(null);

  const latest = runs?.[0] ?? null;
  const previous = runs?.[1] ?? null;

  // Grouped by the failure-taxonomy tag so the set reads as an error analysis
  // rather than an opaque bag of diffs.
  const groups = React.useMemo(() => {
    const by = new Map<string, EvalCaseRecord[]>();
    for (const c of cases ?? []) {
      const k = bucketOf(c) ?? t("evalsTab.bucketOther");
      by.set(k, [...(by.get(k) ?? []), c]);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [cases, t]);

  const passing = (cases ?? []).filter((c) => c.last_run?.pass).length;
  const [lo, hi] = latest ? evalWilson(latest.traces_passed, latest.traces_total) : [0, 1];

  return (
    <div style={s.wrap}>
      <div style={s.sectionHead}>
        <span style={s.sectionLabel}>{t("evalsTab.metricsTitle")}</span>
        <Link href={`/eval/${agent.id}`} style={s.dashLink}>
          {t("evalsTab.viewDashboard")}
        </Link>
      </div>

      {latest ? (
        <>
          <div style={s.tiles}>
            <MetricCard
              label={t("dashboard.passRate")}
              value={`${latest.traces_passed}/${latest.traces_total}`}
              {...(previous
                ? {
                    delta:
                      latest.traces_passed / Math.max(latest.traces_total, 1) -
                      previous.traces_passed / Math.max(previous.traces_total, 1),
                  }
                : {})}
            />
            <MetricCard
              label={t("evalsTab.f1")}
              value={pct(evalF1(latest.precision, latest.recall))}
              {...(previous
                ? { delta: evalF1(latest.precision, latest.recall) - evalF1(previous.precision, previous.recall) }
                : {})}
            />
            <MetricCard
              label={t("dashboard.metrics.recall")}
              value={pct(latest.recall)}
              {...(previous ? { delta: latest.recall - previous.recall } : {})}
            />
            <MetricCard
              label={t("dashboard.metrics.precision")}
              value={pct(latest.precision)}
              {...(previous ? { delta: latest.precision - previous.precision } : {})}
            />
            <MetricCard
              label={t("dashboard.metrics.citationAccuracy")}
              value={pct(latest.citation_accuracy)}
              {...(previous ? { delta: latest.citation_accuracy - previous.citation_accuracy } : {})}
            />
          </div>
          <div style={s.interval}>
            {t("dashboard.interval", { lo: pct(lo), hi: pct(hi) })}
          </div>
        </>
      ) : (
        <div style={s.noRun}>{t("evalsTab.noRunYet")}</div>
      )}

      <div style={s.casesHead}>
        <h2 style={s.h2}>{t("evalsTab.casesHeading")}</h2>
        <span style={s.sectionLabel}>
          {t("evalsTab.passingCount", { passed: passing, total: (cases ?? []).length })}
        </span>
        <div style={s.actions}>
          <Button
            kind="secondary"
            size="sm"
            icon="Play"
            loading={runSuite.isPending}
            disabled={runSuite.isPending || (cases ?? []).length === 0}
            onClick={() => runSuite.mutate(1)}
          >
            {runSuite.isPending ? t("evalsTab.running") : t("evalsTab.runAll")}
          </Button>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setEditing("new")}>
            {t("evalsTab.newCase")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div style={s.noRun}>{t("evalsTab.loadingCases")}</div>
      ) : (cases ?? []).length === 0 ? (
        <EmptyState title={t("evalsTab.emptyCases")} />
      ) : (
        <div style={s.list}>
          {groups.map(([bucket, rows]) => (
            <React.Fragment key={bucket}>
              <div style={s.groupLabel}>{bucket}</div>
              <ul style={{ ...s.list, listStyle: "none", margin: 0, padding: 0 }} aria-label={bucket}>
                {rows.map((c) => {
                  const last = c.last_run;
                  const finds = c.expectations.filter((e) => e.kind === "must_find").length;
                  const avoids = c.expectations.length - finds;
                  return (
                    <li key={c.id} style={s.row}>
                      {last == null ? (
                        <Icon.Dot size={16} style={{ color: "var(--text-muted)" }} />
                      ) : last.pass ? (
                        <Icon.CheckCircle size={16} style={{ color: "var(--ok)" }} />
                      ) : (
                        <Icon.XCircle size={16} style={{ color: "var(--crit)" }} />
                      )}
                      <div style={s.rowMain}>
                        <div style={s.name}>{c.name}</div>
                        <div style={s.sub}>
                          {last == null
                            ? t("evalsTab.neverRun")
                            : `${last.pass ? t("evalsTab.passed") : t("evalsTab.failed")} · ${t(
                                "evalsTab.expectationSummary",
                                { find: finds, avoid: avoids },
                              )}`}
                        </div>
                      </div>
                      <div style={s.rowActions}>
                        <IconBtn
                          icon="Play"
                          label={t("evalsTab.run")}
                          onClick={() => runCase.mutate(c.id)}
                        />
                        <IconBtn icon="Edit" label={t("evalsTab.edit")} onClick={() => setEditing(c)} />
                        <IconBtn
                          icon="Trash"
                          label={t("evalsTab.delete")}
                          danger
                          onClick={() => removeCase.mutate(c.id)}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </React.Fragment>
          ))}
        </div>
      )}

      {editing && (
        <EvalCaseModal
          agentId={agent.id}
          evalCase={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
