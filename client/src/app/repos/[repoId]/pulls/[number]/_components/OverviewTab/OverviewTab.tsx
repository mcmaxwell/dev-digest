"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  repoId: string | null;
  /** `owner/name`, or null before the repo has loaded. */
  repoFullName: string | null;
  headSha: string;
}

export function OverviewTab({ prId, prBody, repoId, repoFullName, headSha }: OverviewTabProps) {
  const t = useTranslations("brief");
  return (
    <>
      {/* Intent and Blast Radius sit SIDE BY SIDE: they answer the two halves of
          the same question - what this PR meant to do, and what it can reach -
          and reading them together is the point. `auto-fit` + `minmax` collapses
          them to one column when narrow, with no media query and no measurement. */}
      <div style={s.briefGrid}>
        <IntentCard prId={prId} />
        <BlastRadiusCard
          prId={prId}
          repoId={repoId}
          repoFullName={repoFullName}
          headSha={headSha}
        />
      </div>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
