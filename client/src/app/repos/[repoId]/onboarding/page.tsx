/* Onboarding Tour — /repos/:repoId/onboarding. One generated, grounded,
   five-section tour per imported repository: what the system is, which files
   carry the weight, how to run it, what to read first, and what to touch first.

   Read-only by construction: every file link leaves for GitHub pinned to the
   generation commit, and the only two actions are Regenerate and Copy as
   Markdown. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSetCrumb } from "@/lib/shell-crumb";
import { useActiveRepo } from "@/lib/repo-context";
import { OnboardingTourView } from "./_components/OnboardingTourView";

export default function OnboardingTourPage() {
  const t = useTranslations("onboarding");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();

  useSetCrumb([{ label: activeRepo?.full_name ?? repoId }, { label: t("title") }]);

  return <OnboardingTourView repoId={repoId} />;
}
