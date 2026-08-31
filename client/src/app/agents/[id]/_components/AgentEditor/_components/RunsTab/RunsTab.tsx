/* RunsTab - L07 companion: this agent's own runs, newest first, and the shared
   trace drawer behind each row.

   The screen where a prompt is tuned is the screen where "what did that run
   actually send" gets asked, and until now the only path to a trace was the run
   history of the pull request the agent happened to run on. This is a LIST, not
   a dashboard: no aggregates, no charts, no run controls (all non-goals). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState } from "@devdigest/ui";
import type { Agent, AgentRunSummary } from "@devdigest/shared";
import { useAgentRuns } from "@/lib/hooks/runs";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { formatRunTime, formatUsd } from "@/lib/format";
import { s } from "./styles";

/** Status colour, by run outcome. The status TEXT carries the meaning; the
    colour only repeats it (accessibility NFR). */
const STATUS_COLOR: Record<string, string> = {
  running: "var(--accent)",
  done: "var(--sev-ok, var(--text-secondary))",
  failed: "var(--sev-critical, #ef4444)",
  cancelled: "var(--text-muted)",
};

function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function RunsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("runs");
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAgentRuns(agent.id);
  const [openRun, setOpenRun] = React.useState<AgentRunSummary | null>(null);

  const runs = React.useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.runs),
    [data],
  );

  // Explicit early returns per state rather than stacked ternaries.
  if (isLoading) {
    return <div style={s.note}>{t("runsTab.loading")}</div>;
  }
  if (isError) {
    return (
      <div style={s.wrap}>
        <div style={s.note}>{t("runsTab.loadError")}</div>
        <Button kind="secondary" size="sm" onClick={() => refetch()}>
          {t("runsTab.retry")}
        </Button>
      </div>
    );
  }
  if (runs.length === 0) {
    return (
      <div style={s.wrap}>
        <EmptyState
          icon="History"
          title={t("runsTab.empty.title")}
          body={t("runsTab.empty.body")}
        />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <h2 style={s.h2}>{t("runsTab.heading")}</h2>
        <span style={s.count}>{t("runsTab.count", { count: runs.length })}</span>
      </div>

      <div style={s.list}>
        {runs.map((r) => (
          <button
            key={r.run_id}
            type="button"
            style={s.row}
            onClick={() => setOpenRun(r)}
            aria-label={t("runsTab.openTrace", { when: formatRunTime(r.ran_at) })}
          >
            <div style={s.rowMain}>
              <div style={s.when}>{formatRunTime(r.ran_at)}</div>
              {r.pr_number != null ? (
                <div style={s.pr} title={r.pr_title ?? undefined}>
                  {t("runsTab.pr", { number: r.pr_number, title: r.pr_title ?? "" })}
                </div>
              ) : (
                // AC-8: the row survives its pull request being deleted.
                <div style={s.noPr}>{t("runsTab.noPr")}</div>
              )}
              {/* AC-7: a failed run states WHY on the row, so the reason needs
                  no drawer. */}
              {r.error && <div style={s.error}>{r.error}</div>}
            </div>

            <div style={s.badges}>
              <Badge color={STATUS_COLOR[r.status ?? ""] ?? "var(--text-secondary)"} dot>
                {t(`runsTab.status.${r.status ?? "unknown"}` as "runsTab.status.done")}
              </Badge>
              <Badge color="var(--text-muted)" mono>
                {t(`runsTab.source.${r.source}` as "runsTab.source.local")}
              </Badge>
            </div>

            <div style={s.meta} className="mono tnum">
              <span>{t("runsTab.findings", { count: r.findings_count ?? 0 })}</span>
              <span>
                {r.score != null
                  ? t("runsTab.score", { score: r.score })
                  : t("runsTab.scoreNone")}
              </span>
              <span>{formatDuration(r.duration_ms) ?? t("runsTab.durationNone")}</span>
              <span>{formatUsd(r.cost_usd)}</span>
            </div>
          </button>
        ))}
      </div>

      {hasNextPage && (
        <div style={s.more}>
          <Button
            kind="secondary"
            size="sm"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? t("runsTab.loading") : t("runsTab.loadMore")}
          </Button>
        </div>
      )}

      {/* AC-18: the trace is requested only once a row opens the drawer. */}
      {openRun && (
        <RunTraceDrawer
          runId={openRun.run_id}
          agentName={agent.name}
          prNumber={openRun.pr_number}
          running={openRun.status === "running"}
          onClose={() => setOpenRun(null)}
        />
      )}
    </div>
  );
}
