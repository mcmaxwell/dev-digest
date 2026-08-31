/* MultiAgentLandingView - this repository's recent multi-agent runs.

   Headers only, by construction: the read behind it (`GET
   /repos/:id/multi-agent-runs`) carries no column, no cluster and no finding,
   so listing twenty past runs never ships twenty runs' worth of rationales. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState } from "@devdigest/ui";
import type { MultiAgentRunSummary } from "@devdigest/shared";
import { useRepoMultiAgentRuns } from "@/lib/hooks/multi-agent";
import { formatRunTime, formatUsd } from "@/lib/format";
import { s } from "./styles";

/** Status colour. The status TEXT carries the meaning; colour only repeats it. */
const STATUS_COLOR: Record<MultiAgentRunSummary["status"], string> = {
  running: "var(--accent)",
  done: "var(--sev-ok, var(--text-secondary))",
  failed: "var(--sev-critical, #ef4444)",
};

export function MultiAgentLandingView({ repoId }: { repoId: string }) {
  const t = useTranslations("runs");
  const router = useRouter();
  const { data: runs, isLoading, isError, refetch } = useRepoMultiAgentRuns(repoId);

  const startNew = () => router.push(`/repos/${repoId}/multi-agent/new`);

  return (
    <div style={s.wrap}>
      <h1 style={s.title}>{t("page.title")}</h1>
      {/* The landing's OWN subtitle. "Pick a pull request and choose which
          agents to fan out" describes the configure screen, which is a
          different route since amendment 01 split them. */}
      <p style={s.subtitle}>{t("page.landingSubtitle")}</p>

      <div style={s.head}>
        <h2 style={s.h2}>{t("page.recent.heading")}</h2>
        <div style={s.actions}>
          <Button kind="primary" size="sm" icon="Users" onClick={startNew}>
            {t("page.recent.new")}
          </Button>
        </div>
      </div>

      <RunList
        repoId={repoId}
        runs={runs}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
      />
    </div>
  );
}

/** Explicit early return per state rather than stacked ternaries in the view. */
function RunList({
  repoId,
  runs,
  isLoading,
  isError,
  onRetry,
}: {
  repoId: string;
  runs: MultiAgentRunSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("runs");
  const router = useRouter();

  if (isLoading) return <div style={s.note}>{t("page.recent.loading")}</div>;
  if (isError) {
    return (
      <div>
        <div style={s.note}>{t("page.recent.loadError")}</div>
        <Button kind="secondary" size="sm" onClick={onRetry}>
          {t("page.recent.retry")}
        </Button>
      </div>
    );
  }
  if (!runs || runs.length === 0) {
    return (
      <EmptyState
        icon="Users"
        title={t("page.recent.empty.title")}
        body={t("page.recent.empty.body")}
      />
    );
  }

  return (
    <div style={s.list}>
      {runs.map((r) => (
        <button
          key={r.id}
          type="button"
          style={s.row}
          onClick={() => router.push(`/repos/${repoId}/multi-agent/${r.id}`)}
          aria-label={t("page.recent.open", {
            number: r.pr_number ?? 0,
            when: formatRunTime(r.ran_at),
          })}
        >
          <div style={s.rowMain}>
            <div style={s.pr} title={r.pr_title ?? undefined}>
              {r.pr_number != null
                ? t("page.prItem", { number: r.pr_number, title: r.pr_title ?? "" })
                : t("page.recent.noPr")}
            </div>
            <div style={s.sub}>
              {t("page.recent.agents", { count: r.agent_count })} ·{" "}
              {formatRunTime(r.ran_at)}
            </div>
          </div>

          <div style={s.badges}>
            <Badge color={STATUS_COLOR[r.status]} dot>
              {t(`page.recent.status.${r.status}` as "page.recent.status.done")}
            </Badge>
          </div>

          <div style={s.meta} className="mono tnum">
            <span>{t("page.recent.findings", { count: r.findings_count })}</span>
            <span>
              {r.total_duration_ms != null
                ? `${(r.total_duration_ms / 1000).toFixed(1)}s`
                : t("page.recent.noDuration")}
            </span>
            {/* The partial marker is what stops a run with an unpriced agent
                reading as cheap rather than as incompletely priced. */}
            <span>
              {r.total_cost_partial
                ? t("page.metaPartial", { cost: formatUsd(r.total_cost_usd) })
                : formatUsd(r.total_cost_usd)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
