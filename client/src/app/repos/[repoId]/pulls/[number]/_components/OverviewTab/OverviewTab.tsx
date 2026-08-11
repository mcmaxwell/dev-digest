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
      {/* Intent sits ABOVE the description: it is derived FROM the description,
          and the reader should verify the machine's reading first. */}
      <IntentCard prId={prId} />
      {/* Blast radius comes after intent: intent says what the PR MEANT to do,
          this says what it can REACH, and the second is only worth reading once
          the first has been checked. */}
      <BlastRadiusCard
        prId={prId}
        repoId={repoId}
        repoFullName={repoFullName}
        headSha={headSha}
      />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
