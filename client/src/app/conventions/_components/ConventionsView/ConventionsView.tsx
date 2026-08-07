/* /conventions — extracted house-rules for the active repo (L02).

   Each card is one candidate with the evidence it was grounded against; accept
   the ones that are real, reject the rest, then merge the accepted set into a
   Skill and attach it to a review agent. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { useSetCrumb } from "@/lib/shell-crumb";
import { useActiveRepo } from "@/lib/repo-context";
import { useConventions, useExtractConventions, useUpdateConvention } from "@/lib/hooks/conventions";
import { useToast } from "@/lib/toast";
import { ConventionCard } from "./_components/ConventionCard";
import { CreateSkillFromConventionsModal } from "./_components/CreateSkillFromConventionsModal";
import { acceptedOf, groupByCategory, relativeTime } from "./helpers";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const toast = useToast();
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;

  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId, () => toast.error(t("page.updateFailed")));
  const [creating, setCreating] = React.useState(false);

  useSetCrumb([{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]);

  const repoName = activeRepo?.full_name.split("/").pop() ?? t("page.repoFallback");
  const candidates = React.useMemo(() => data?.candidates ?? [], [data]);
  const scan = data?.scan ?? null;
  const scanning = scan?.status === "running" || extract.isPending;
  // Memoized so the create-skill modal's draft effect keys on a stable value
  // rather than a fresh array identity every render.
  const accepted = React.useMemo(() => acceptedOf(candidates), [candidates]);

  const setStatus = (c: ConventionCandidate, status: ConventionCandidate["status"]) =>
    update.mutate({ id: c.id, patch: { status } });

  const editRule = (c: ConventionCandidate, rule: string) =>
    update.mutate({ id: c.id, patch: { rule } });

  const runExtraction = async () => {
    try {
      await extract.mutateAsync();
    } catch {
      toast.error(t("page.extractionFailed"));
    }
  };

  const deselectAll = () => {
    for (const c of accepted) setStatus(c, "pending");
  };

  if (!repoId) {
    return (
      <div style={s.page}>
        <EmptyState icon="ListChecks" title={t("page.noRepo.title")} body={t("page.noRepo.body")} />
      </div>
    );
  }

  return (
    <>
      {creating && activeRepo && (
        <CreateSkillFromConventionsModal
          repoId={repoId}
          repoName={repoName}
          accepted={accepted}
          onClose={() => setCreating(false)}
        />
      )}

      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repoName}>
                {repoName}
              </span>
            </h1>
            {scan ? (
              <div style={s.scanMeta}>
                {t("page.scanMeta", { samples: scan.sample_count })}
                {scan.finished_at ? ` · ${relativeTime(scan.finished_at)}` : ""}
              </div>
            ) : (
              <p style={s.subtitle}>{t("page.subtitle")}</p>
            )}
          </div>
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={scanning}
            disabled={scanning}
            onClick={runExtraction}
          >
            {scanning ? t("page.scanning") : scan ? t("page.rescan") : t("page.runExtraction")}
          </Button>
        </div>

        {scan?.status === "error" && (
          <div style={s.banner}>
            <strong>{t("page.scanFailed.title")}</strong>
            <span>
              {scan.error === "repo_not_cloned" ? t("page.scanFailed.notCloned") : scan.error}
            </span>
          </div>
        )}

        {isError && <ErrorState body={t("page.loadError")} onRetry={() => void refetch()} />}

        {isLoading && (
          <div style={s.skeletons}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        )}

        {!isLoading && !isError && candidates.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={runExtraction}
            ctaLoading={scanning}
          />
        )}

        {candidates.length > 0 && (
          <>
            <div style={s.toolbar}>
              <Button
                kind="ghost"
                size="sm"
                icon="X"
                disabled={accepted.length === 0}
                onClick={deselectAll}
              >
                {t("page.selection.deselectAll")}
              </Button>
              <span style={s.counter}>
                {t("page.selection.counter", {
                  accepted: accepted.length,
                  total: candidates.length,
                })}
              </span>
              <Button
                kind="primary"
                size="sm"
                icon="Sparkles"
                disabled={accepted.length === 0}
                onClick={() => setCreating(true)}
              >
                {t("page.selection.createSkill")}
              </Button>
            </div>

            <div style={s.groups}>
              {groupByCategory(candidates).map(({ category, items }) => (
                <section key={category} style={s.group}>
                  <SectionLabel
                    right={<span style={s.groupCount}>{items.length}</span>}
                  >
                    {t(`category.${category}`)}
                  </SectionLabel>
                  {items.map((c) => (
                    <ConventionCard
                      key={c.id}
                      candidate={c}
                      repoFullName={activeRepo?.full_name ?? null}
                      busy={update.isPending}
                      onStatus={(status) => setStatus(c, status)}
                      onEdit={(rule) => editRule(c, rule)}
                    />
                  ))}
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
