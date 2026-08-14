"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type { PrCommit } from "@devdigest/shared";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { PrBriefCard } from "../PrBriefCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  repoId: string | null;
  /** `owner/name`, or null before the repo has loaded. */
  repoFullName: string | null;
  headSha: string;
  /** The PR's commits — the spine of the brief-history timeline. */
  commits: PrCommit[];
  /** A URL for the Files changed tab with `path` expanded. Built by the page. */
  fileHref: (path: string) => string;
  /** The client-side jump a file reference performs instead of a navigation. */
  onOpenFile: (path: string) => void;
}

export function OverviewTab({
  prId,
  prBody,
  repoId,
  repoFullName,
  headSha,
  commits,
  fileHref,
  onOpenFile,
}: OverviewTabProps) {
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
      {/* The brief sits BELOW the grid, full width: its review-focus list is a
          reading order, and the two cards above are the facts it was built from.
          On a narrow viewport the grid collapses to one column and the brief's
          blocks stack beneath it, which is the same layout by construction. */}
      <PrBriefCard
        prId={prId}
        commits={commits}
        fileHref={fileHref}
        onOpenFile={onOpenFile}
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
