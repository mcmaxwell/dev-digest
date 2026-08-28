/* /eval/:agentId — one agent's regression harness (L06).

   Reads top to bottom as an argument: how the set stands now (pass rate first,
   with its interval, because the ratios below are measured over a handful of
   cases), how it has moved (the trend), and then the runs themselves — tick two
   and compare them. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Icon,
  LineChart,
  MetricCard,
  Skeleton,
} from "@devdigest/ui";
import { evalF1, evalWilson } from "@devdigest/shared/contracts/eval-math";
import { useSetCrumb } from "@/lib/shell-crumb";
import { useAgent } from "@/lib/hooks/agents";
import { useEvalCases, useEvalRuns, useRunEvalSuite } from "@/lib/hooks/eval";
import { CompareRunsModal } from "./_components/CompareRunsModal";
import { s } from "./styles";

const pct = (n: number) => `${Math.round(n * 100)}%`;

function stamp(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function AgentEvalView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const { data: agent } = useAgent(agentId);
  const { data: cases } = useEvalCases(agentId);
  const { data: runs, isLoading, isError, refetch } = useEvalRuns(agentId);
  const runSuite = useRunEvalSuite(agentId);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState<[string, string] | null>(null);

  useSetCrumb([
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: agent?.name ?? "" },
  ]);

  const latest = runs?.[0] ?? null;
  const previous = runs?.[1] ?? null;
  const [lo, hi] = latest ? evalWilson(latest.traces_passed, latest.traces_total) : [0, 1];

  // Oldest-first so the chart reads left to right.
  const chronological = React.useMemo(() => [...(runs ?? [])].reverse(), [runs]);
  const series = React.useMemo(
    () => [
      { name: t("dashboard.legend.recall"), color: "var(--accent)", data: chronological.map((r) => r.recall) },
      { name: t("dashboard.legend.precision"), color: "var(--ok)", data: chronological.map((r) => r.precision) },
      { name: t("dashboard.legend.citation"), color: "var(--warn)", data: chronological.map((r) => r.citation_accuracy) },
    ],
    [chronological, t],
  );

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2),
    );

  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div style={s.wrap}>
      <Link href="/eval" style={s.back}>
        <Icon.ChevronLeft size={14} /> {t("dashboard.backToAgents")}
      </Link>

      <div style={s.head}>
        <div>
          <h1 style={s.h1}>{agent?.name ?? ""}</h1>
          <div style={s.sub}>
            {t("dashboard.casesSummary", {
              count: cases?.length ?? 0,
              runs: runs?.length ?? 0,
            })}
          </div>
        </div>
        <div style={s.headActions}>
          <Button
            kind="primary"
            icon="Play"
            loading={runSuite.isPending}
            disabled={runSuite.isPending || (cases?.length ?? 0) === 0}
            onClick={() => runSuite.mutate(1)}
          >
            {runSuite.isPending
              ? t("dashboard.running")
              : t("dashboard.runEval", { count: cases?.length ?? 0 })}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton />
      ) : !latest ? (
        <EmptyState title={t("dashboard.noRuns")} />
      ) : (
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
                ? {
                    delta:
                      evalF1(latest.precision, latest.recall) -
                      evalF1(previous.precision, previous.recall),
                  }
                : {})}
            />
            <MetricCard
              label={t("dashboard.metrics.recall")}
              value={pct(latest.recall)}
              trend={chronological.map((r) => r.recall)}
              {...(previous ? { delta: latest.recall - previous.recall } : {})}
            />
            <MetricCard
              label={t("dashboard.metrics.precision")}
              value={pct(latest.precision)}
              trend={chronological.map((r) => r.precision)}
              {...(previous ? { delta: latest.precision - previous.precision } : {})}
            />
            <MetricCard
              label={t("dashboard.metrics.citationAccuracy")}
              value={pct(latest.citation_accuracy)}
              trend={chronological.map((r) => r.citation_accuracy)}
              {...(previous ? { delta: latest.citation_accuracy - previous.citation_accuracy } : {})}
            />
          </div>
          <div style={s.interval}>{t("dashboard.interval", { lo: pct(lo), hi: pct(hi) })}</div>

          {chronological.length > 1 && (
            <div style={s.panel}>
              <div style={s.panelHead}>
                <span style={s.sectionLabel}>{t("dashboard.metricTrend")}</span>
                <div style={s.legend}>
                  {series.map((se) => (
                    <span key={se.name} style={s.legendItem(se.color)}>
                      <span style={s.swatch(se.color)} /> {se.name}
                    </span>
                  ))}
                </div>
              </div>
              <LineChart series={series} w={1080} h={220} />
            </div>
          )}

          <div style={s.panel}>
            <div style={s.panelHead}>
              <span style={s.sectionLabel}>{t("dashboard.recentRuns")}</span>
              <div style={{ marginLeft: "auto" }}>
                <Button
                  kind="primary"
                  size="sm"
                  icon="GitMerge"
                  disabled={selected.length !== 2}
                  onClick={() => {
                    // Oldest as the left column, so a delta reads as "since".
                    const [a, b] = selected;
                    const order = (runs ?? []).map((r) => r.id);
                    const left = order.indexOf(a!) > order.indexOf(b!) ? a! : b!;
                    const right = left === a ? b! : a!;
                    setComparing([left, right]);
                  }}
                >
                  {t("compare.compare")}
                </Button>
              </div>
            </div>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th} />
                  <th style={s.th}>{t("dashboard.table.ranAt")}</th>
                  <th style={s.th}>{t("dashboard.table.version")}</th>
                  <th style={s.th}>{t("dashboard.table.recall")}</th>
                  <th style={s.th}>{t("dashboard.table.precision")}</th>
                  <th style={s.th}>{t("dashboard.table.citation")}</th>
                  <th style={s.th}>{t("dashboard.table.pass")}</th>
                  <th style={s.th}>{t("dashboard.table.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {(runs ?? []).map((r) => (
                  <tr key={r.id}>
                    <td style={s.td}>
                      <Checkbox
                        checked={selected.includes(r.id)}
                        onChange={() => toggle(r.id)}
                        label=""
                      />
                    </td>
                    <td style={{ ...s.td, ...s.mono }}>{stamp(r.ran_at)}</td>
                    <td style={{ ...s.td, ...s.mono }}>v{r.agent_version ?? 1}</td>
                    <td style={{ ...s.td, ...s.mono }}>{pct(r.recall)}</td>
                    <td style={{ ...s.td, ...s.mono }}>{pct(r.precision)}</td>
                    <td style={{ ...s.td, ...s.mono }}>{pct(r.citation_accuracy)}</td>
                    <td style={{ ...s.td, ...s.mono }}>
                      {r.traces_passed}/{r.traces_total}
                    </td>
                    <td style={{ ...s.td, ...s.mono }}>
                      {r.cost_usd == null ? "—" : `$${r.cost_usd.toFixed(3)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {selected.length !== 2 && <div style={s.hint}>{t("compare.selectTwo")}</div>}
          </div>
        </>
      )}

      {comparing && (
        <CompareRunsModal
          left={comparing[0]}
          right={comparing[1]}
          onClose={() => setComparing(null)}
        />
      )}
    </div>
  );
}
