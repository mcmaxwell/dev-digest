/* StatsTab — usage statistics for one skill. Attribution is transitive: the
   agents this skill is attached to, plus those agents' runs and review
   findings (runs record the rendered prompt, not skill ids). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "@/lib/hooks/skills";
import { s } from "./styles";

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={84} />
        <Skeleton height={140} />
      </div>
    );
  }
  if (isError || !data) {
    return <ErrorState title={t("stats.loadError")} onRetry={() => refetch()} />;
  }

  const tiles = [
    { key: "runs", value: data.runs_count },
    { key: "findings", value: data.findings_count },
    { key: "accepted", value: data.accepted_count },
    { key: "dismissed", value: data.dismissed_count },
  ] as const;

  return (
    <div style={s.wrap}>
      <div style={s.tiles}>
        {tiles.map((tile) => (
          <div key={tile.key} style={s.tile}>
            <div className="mono" style={s.tileValue}>
              {tile.value}
            </div>
            <div style={s.tileLabel}>{t(`stats.${tile.key}`)}</div>
          </div>
        ))}
      </div>
      <div style={s.lastRun}>
        {t("stats.lastRun")}:{" "}
        <span className="mono">
          {data.last_run_at ? new Date(data.last_run_at).toLocaleString() : t("stats.never")}
        </span>
      </div>

      <h3 style={s.sectionTitle}>{t("stats.agentsTitle")}</h3>
      {data.agents.length === 0 ? (
        <EmptyState icon="Cpu" title={t("stats.agentsEmptyTitle")} body={t("stats.agentsEmpty")} />
      ) : (
        <div style={s.agentList}>
          {data.agents.map((a) => (
            <div key={a.id} style={s.agentRow}>
              <span className="mono" style={s.agentName}>
                {a.name}
              </span>
              {!a.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
              <div style={s.agentRowRight}>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="ExternalLink"
                  onClick={() => router.push(`/agents/${a.id}?tab=skills`)}
                >
                  {t("stats.openAgent")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={s.note}>{t("stats.note")}</div>
    </div>
  );
}
