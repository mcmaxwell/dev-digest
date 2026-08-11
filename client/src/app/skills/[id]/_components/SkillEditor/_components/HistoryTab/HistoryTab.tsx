/* HistoryTab — the skill's immutable body snapshots, newest first. A row
   expands to show that version's body; Restore saves an old body AS A NEW
   version through the rollback endpoint (history is never rewritten). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useRollbackSkill, useSkillVersions } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { s } from "./styles";

export function HistoryTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const rollback = useRollbackSkill();
  const [expanded, setExpanded] = React.useState<number | null>(null);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>
    );
  }
  if (isError || !versions) {
    return <ErrorState title={t("history.loadError")} onRetry={() => refetch()} />;
  }
  if (versions.length === 0) {
    return <EmptyState icon="History" title={t("history.empty")} />;
  }

  const restore = (version: number) => {
    if (!window.confirm(t("history.restoreConfirm", { version }))) return;
    rollback.mutate(
      { id: skill.id, version },
      {
        onSuccess: (data) =>
          toast.success(t("history.restored", { version, newVersion: data.version })),
      },
    );
  };

  return (
    <div style={s.wrap}>
      {versions.map((v) => {
        const current = v.version === skill.version;
        const open = expanded === v.version;
        return (
          <div key={v.version} style={s.row}>
            <div style={s.rowHeader} onClick={() => setExpanded(open ? null : v.version)}>
              <Badge color={current ? "var(--accent)" : "var(--text-muted)"} mono>
                {t("preview.version", { version: v.version })}
              </Badge>
              {current && <Badge color="var(--ok)">{t("history.current")}</Badge>}
              <span style={s.date}>{new Date(v.created_at).toLocaleString()}</span>
              {!current && (
                <span style={s.rowRight}>
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="History"
                    disabled={rollback.isPending}
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      restore(v.version);
                    }}
                  >
                    {rollback.isPending ? t("history.restoring") : t("history.restore")}
                  </Button>
                </span>
              )}
            </div>
            {open && (
              <pre className="mono" style={s.bodyPreview}>
                {v.body}
              </pre>
            )}
          </div>
        );
      })}
      <div style={s.note}>{t("history.note")}</div>
    </div>
  );
}
