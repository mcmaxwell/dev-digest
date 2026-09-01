/* Multi-Agent Review landing - /repos/:repoId/multi-agent.

   The list of this repository's recent multi-agent runs, plus the one control
   that starts another. It is deliberately not the configure screen: a user who
   has just run a review and comes back to the page must be able to reach that
   run again, and a page that only ever offers to start a new one cannot do
   that. The configure screen lives one segment down, at `/new`. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSetCrumb } from "@/lib/shell-crumb";
import { useActiveRepo } from "@/lib/repo-context";
import { MultiAgentLandingView } from "./_components/MultiAgentLandingView";

export default function MultiAgentLandingPage() {
  const t = useTranslations("runs");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();

  useSetCrumb([{ label: activeRepo?.full_name ?? repoId }, { label: t("page.crumb") }]);

  return <MultiAgentLandingView repoId={repoId} />;
}
