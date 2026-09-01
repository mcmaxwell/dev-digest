/* /ci-runs - every review an agent ran inside CI (L06).

   The list is READ-ONLY and bounded: `GET /ci-runs` caps what it returns, and
   the four dropdowns filter that list in the browser. Refresh is therefore an
   `invalidateQueries`, not a round trip to GitHub - nothing is pulled from
   anywhere, the runner pushes a run when it finishes one. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, ErrorState, Icon, SelectInput, Skeleton } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared";
import { useSetCrumb } from "@/lib/shell-crumb";
import { ciKeys, useCiRuns } from "@/lib/hooks/ci";
import { ALL, DEFAULT_WINDOW, STATUSES, TIME_WINDOWS } from "./constants";
import { s } from "./styles";

/** Local time, seconds trimmed - the run list is scanned, not audited. */
function stamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** The distinct values of one column, for a dropdown, in first-seen order. */
function distinct(runs: CiRun[], pick: (r: CiRun) => string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const r of runs) {
    const v = pick(r);
    if (v) seen.add(v);
  }
  return [...seen];
}

export function CiRunsView() {
  const t = useTranslations("ci");
  const qc = useQueryClient();
  const { data, isLoading, isError, isFetching, refetch } = useCiRuns();

  // Named `timeWindow`, not `window`: shadowing the global in a client
  // component is how a later edit reaches for `window.location` and gets a string.
  const [timeWindow, setTimeWindow] = React.useState<string>(DEFAULT_WINDOW);
  const [agent, setAgent] = React.useState<string>(ALL);
  const [repo, setRepo] = React.useState<string>(ALL);
  const [status, setStatus] = React.useState<string>(ALL);

  useSetCrumb([{ label: t("page.crumb") }]);

  const runs = React.useMemo(() => data ?? [], [data]);

  const filtered = React.useMemo(() => {
    const days = TIME_WINDOWS.find((w) => w.key === timeWindow)?.days ?? null;
    const since = days === null ? null : Date.now() - days * 24 * 60 * 60 * 1000;
    return runs.filter((r) => {
      // A run with no timestamp cannot be placed in a window, so it survives
      // every window rather than disappearing from all of them.
      if (since !== null && r.ran_at && new Date(r.ran_at).getTime() < since) return false;
      if (agent !== ALL && r.agent !== agent) return false;
      if (repo !== ALL && r.repo !== repo) return false;
      if (status !== ALL && r.status !== status) return false;
      return true;
    });
  }, [runs, timeWindow, agent, repo, status]);

  const windowOptions = TIME_WINDOWS.map((w) => ({
    value: w.key,
    label: t(`runs.filters.${w.key}`),
  }));
  const agentOptions = [
    { value: ALL, label: t("runs.filters.allAgents") },
    ...distinct(runs, (r) => r.agent).map((v) => ({ value: v, label: v })),
  ];
  const repoOptions = [
    { value: ALL, label: t("runs.filters.allRepos") },
    ...distinct(runs, (r) => r.repo).map((v) => ({ value: v, label: v })),
  ];
  const statusOptions = [
    { value: ALL, label: t("runs.filters.allStatuses") },
    ...STATUSES.map((st) => ({ value: st.value, label: t(`runs.status.${st.key}`) })),
  ];

  const statusLabel = (value: string | null) => {
    const known = STATUSES.find((st) => st.value === value);
    return known ? t(`runs.status.${known.key}`) : (value ?? "—");
  };

  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div>
          <h1 style={s.h1}>{t("runs.title")}</h1>
          <div style={s.sub}>
            {t("runs.subtitle")} · {t("runs.autoRefresh")}
          </div>
        </div>
        <div style={s.spacer} />
        <Button
          icon="RefreshCw"
          onClick={() => void qc.invalidateQueries({ queryKey: ciKeys.runs() })}
        >
          {isFetching ? t("runs.refreshing") : t("runs.refresh")}
        </Button>
      </div>

      <div style={s.filters}>
        <SelectInput
          value={timeWindow}
          onChange={setTimeWindow}
          options={windowOptions}
          mono={false}
        />
        <SelectInput value={agent} onChange={setAgent} options={agentOptions} mono={false} />
        <SelectInput value={repo} onChange={setRepo} options={repoOptions} mono={false} />
        <SelectInput value={status} onChange={setStatus} options={statusOptions} mono={false} />
      </div>

      {isLoading ? (
        <Skeleton />
      ) : filtered.length === 0 ? (
        <EmptyState title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>{t("runs.table.timestamp")}</th>
              <th style={s.th}>{t("runs.table.pullRequest")}</th>
              <th style={s.th}>{t("runs.table.source")}</th>
              <th style={s.th}>{t("runs.table.findings")}</th>
              <th style={s.th}>{t("runs.table.cost")}</th>
              <th style={s.th}>{t("runs.table.status")}</th>
              <th style={s.th} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td style={{ ...s.td, ...s.mono }}>{stamp(r.ran_at)}</td>
                <td style={s.td}>
                  {r.repo && r.pr_number
                    ? t("runs.pullRequestCell", { repo: r.repo, number: r.pr_number })
                    : (r.repo ?? "—")}
                </td>
                <td style={{ ...s.td, ...s.mono }}>{r.source ?? "—"}</td>
                <td style={{ ...s.td, ...s.mono }}>{r.findings_count ?? "—"}</td>
                <td style={{ ...s.td, ...s.mono }}>
                  {r.cost_usd == null ? "—" : `$${r.cost_usd.toFixed(3)}`}
                </td>
                <td style={s.td}>{statusLabel(r.status)}</td>
                <td style={s.td}>
                  {r.github_url && (
                    <a href={r.github_url} target="_blank" rel="noreferrer" style={s.view}>
                      {t("runs.view")}
                      <Icon.ArrowRight size={12} />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
