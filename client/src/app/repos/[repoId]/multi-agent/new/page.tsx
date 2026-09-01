/* Configure a multi-agent run - /repos/:repoId/multi-agent/new.

   A STATIC segment beside the dynamic `[runId]` one; the App Router resolves
   `new` first, so `/multi-agent/new` can never be read as a run id. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSetCrumb } from "@/lib/shell-crumb";
import { useActiveRepo } from "@/lib/repo-context";
import { MultiAgentConfigureView } from "./_components/MultiAgentConfigureView";

export default function MultiAgentConfigurePage() {
  const t = useTranslations("runs");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();

  useSetCrumb([
    { label: activeRepo?.full_name ?? repoId },
    { label: t("page.crumb"), href: `/repos/${repoId}/multi-agent` },
    { label: t("page.configureCrumb") },
  ]);

  return <MultiAgentConfigureView repoId={repoId} />;
}
