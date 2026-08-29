/* /eval — the regression harness across every reviewer agent (L06).

   The index answers one question per agent: is its case set still passing, and
   which way is it moving. Each row leads with the binary pass rate because the
   three ratios only make sense once you know how many cases they were measured
   over. Clicking a row opens that agent's runs. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Skeleton, Sparkline } from "@devdigest/ui";
import { evalF1 } from "@devdigest/shared/contracts/eval-math";
import { useSetCrumb } from "@/lib/shell-crumb";
import { useEvalDashboard } from "@/lib/hooks/eval";
import { s } from "./styles";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Local time, seconds trimmed — the run list is scanned, not audited. */
function stamp(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalDashboard();

  useSetCrumb([{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]);

  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div>
          <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
          <div style={s.sub}>{t("dashboard.subtitle")}</div>
        </div>
      </div>

      <div style={s.sectionLabel}>{t("dashboard.agents")}</div>
      {isLoading ? (
        <Skeleton />
      ) : (data?.agents ?? []).length === 0 ? (
        <EmptyState title={t("dashboard.noAgents")} />
      ) : (
        <ul style={s.list} aria-label={t("dashboard.agents")}>
          {data!.agents.map((a) => {
            const run = a.last_run;
            return (
              <li key={a.agent_id}>
                <Link href={`/eval/${a.agent_id}`} style={s.card}>
                  <Icon.FlaskConical size={20} style={{ color: "var(--accent)" }} />
                  <div style={s.agentMain}>
                    <div style={s.agentName}>{a.agent_name}</div>
                    <div style={s.agentSub}>
                      {t("dashboard.casesCount", { count: a.cases_total })}
                      {run
                        ? ` · ${t("dashboard.lastRun", {
                            version: run.agent_version ?? 1,
                            ranAt: stamp(run.ran_at),
                            passed: run.traces_passed,
                            total: run.traces_total,
                          })}`
                        : ` · ${t("dashboard.neverRun")}`}
                    </div>
                  </div>
                  {a.trend.length > 1 && <Sparkline data={a.trend} />}
                  {run && (
                    <>
                      <div style={s.metric}>
                        <div style={s.metricLabel}>{t("evalsTab.f1")}</div>
                        <div style={s.metricValue("var(--text-primary)")}>
                          {pct(evalF1(run.precision, run.recall))}
                        </div>
                      </div>
                      <div style={s.metric}>
                        <div style={s.metricLabel}>{t("dashboard.legend.recall")}</div>
                        <div style={s.metricValue("var(--accent)")}>{pct(run.recall)}</div>
                      </div>
                      <div style={s.metric}>
                        <div style={s.metricLabel}>{t("dashboard.legend.precision")}</div>
                        <div style={s.metricValue("var(--ok)")}>{pct(run.precision)}</div>
                      </div>
                      <div style={s.metric}>
                        <div style={s.metricLabel}>{t("dashboard.legend.citation")}</div>
                        <div style={s.metricValue("var(--warn)")}>{pct(run.citation_accuracy)}</div>
                      </div>
                    </>
                  )}
                  <Icon.ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div style={s.sectionLabel}>{t("dashboard.recentAll")}</div>
      {(data?.recent_runs ?? []).length === 0 ? (
        <EmptyState title={t("dashboard.noRuns")} />
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>{t("dashboard.table.ranAt")}</th>
              <th style={s.th}>{t("page.crumbAgents")}</th>
              <th style={s.th}>{t("dashboard.table.recall")}</th>
              <th style={s.th}>{t("dashboard.table.precision")}</th>
              <th style={s.th}>{t("dashboard.table.citation")}</th>
              <th style={s.th}>{t("dashboard.table.pass")}</th>
              <th style={s.th}>{t("dashboard.table.cost")}</th>
            </tr>
          </thead>
          <tbody>
            {data!.recent_runs.map((r) => (
              <tr key={r.id}>
                <td style={{ ...s.td, ...s.mono }}>{stamp(r.ran_at)}</td>
                <td style={s.td}>
                  {r.agent_name}
                  <span style={{ ...s.mono, color: "var(--text-muted)" }}>
                    {" "}
                    v{r.agent_version ?? 1}
                  </span>
                </td>
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
      )}
    </div>
  );
}
