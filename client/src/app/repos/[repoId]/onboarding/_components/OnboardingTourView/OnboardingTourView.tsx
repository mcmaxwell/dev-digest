/* OnboardingTourView — the Onboarding Tour page body.

   Four states, each an EARLY RETURN rather than a rung of a stacked ternary:

     no clone     → the prerequisite, named, with no Generate control at all
     clone, none  → the call to action, stating what will be produced
     generating   → the current phase plus the five headings, OVER the previous
                    tour when there is one (a regeneration must not blank the
                    page the user is reading)
     ready/degraded → the tour

   There is no error state for a stored tour. A missing index, unavailable
   issues and a failed model call are all statuses this page renders, not
   failures it refuses to render. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useActiveRepo } from "@/lib/repo-context";
import { useGenerateOnboarding, useOnboarding } from "@/lib/hooks/onboarding";
import { PageNav } from "./_components/PageNav";
import { SectionCard } from "./_components/SectionCard";
import { TourHeader } from "./_components/TourHeader";
import { NARROW_VIEWPORT_PX, SECTION_KINDS } from "./constants";
import { s } from "./styles";

/** Tracks the sub-900px breakpoint. The media query is the external system. */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${NARROW_VIEWPORT_PX - 1}px)`);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

export function OnboardingTourView({ repoId }: { repoId: string }) {
  const t = useTranslations("onboarding");
  const { repos } = useActiveRepo();
  const { data, isLoading, isError, refetch } = useOnboarding(repoId);
  const generate = useGenerateOnboarding();
  const narrow = useNarrowViewport();

  const repoFullName = repos.find((r) => r.id === repoId)?.full_name ?? repoId;
  const onGenerate = React.useCallback(() => generate.mutate(repoId), [generate, repoId]);

  if (isLoading) {
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 10 }}>
        <Skeleton height={16} width="30%" />
        <Skeleton height={12} />
        <Skeleton height={12} />
      </div>
    );
  }

  // Only the READ can fail this way — a stored tour never does.
  if (isError || !data) {
    return <ErrorState title={t("loadError.title")} onRetry={() => void refetch()} />;
  }

  // The clone is the prerequisite for every fact this page shows, so it is
  // named rather than implied — and no Generate control is offered.
  if (data.clone === "absent") {
    return <EmptyState icon="Database" title={t("noClone.title")} body={t("noClone.body")} />;
  }

  const generating = data.generation.status === "running" || generate.isPending;

  if (!data.tour) {
    if (generating) return <GeneratingState phase={data.generation.phase} />;
    return (
      <EmptyState
        icon="Workflow"
        title={t("generate.title")}
        body={t("generate.body")}
        cta={generate.isPending ? t("generate.generating") : t("generate.cta")}
        onCta={onGenerate}
      />
    );
  }

  const tour = data.tour;

  return (
    <div style={s.wrap}>
      {generating && <GeneratingBanner phase={data.generation.phase} />}
      {narrow && <PageNav narrow />}
      <div style={s.layout(narrow)}>
        <div style={s.column}>
          <TourHeader
            page={data}
            tour={tour}
            repoFullName={repoFullName}
            onRegenerate={onGenerate}
            regenerating={generating}
          />
          {/* Ordered by the fixed section list, not by what the model returned. */}
          {SECTION_KINDS.map((kind) => {
            const section = tour.sections.find((sec) => sec.kind === kind);
            return section ? (
              <SectionCard
                key={kind}
                section={section}
                repoFullName={repoFullName}
                headSha={tour.head_sha}
              />
            ) : null;
          })}
        </div>
        {!narrow && <PageNav narrow={false} />}
      </div>
    </div>
  );
}

/** The generating state for a repository that has no tour to show underneath. */
function GeneratingState({ phase }: { phase: string | null }) {
  const t = useTranslations("onboarding");
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
      <GeneratingBanner phase={phase} />
      {/* The five headings are visible from the first second, so the shape of
          what is coming is never a surprise. */}
      {SECTION_KINDS.map((kind) => (
        <div key={kind} style={s.card}>
          <div style={s.cardHead}>
            <Icon.ChevronDown size={15} />
            <span style={s.cardTitle}>{t(`sectionTitles.${kind}`)}</span>
          </div>
          <div style={s.cardBody}>
            <Skeleton height={12} />
            <Skeleton height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

function GeneratingBanner({ phase }: { phase: string | null }) {
  const t = useTranslations("onboarding");
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ ...s.reason, padding: "10px 24px", color: "var(--text-secondary)" }}
    >
      <Icon.RefreshCw size={13} style={{ animation: "ddspin 1s linear infinite" }} />
      <span>
        {t("generating.title")}
        {phase ? ` — ${t(`generating.phase.${phase}`)}` : ""}
      </span>
    </div>
  );
}
