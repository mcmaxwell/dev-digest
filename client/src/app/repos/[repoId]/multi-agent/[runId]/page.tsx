/* Multi-Agent Review results - /repos/:repoId/multi-agent/:runId.

   One request paints the whole screen: header, per-agent columns and the
   disagreement clusters all come from `GET /multi-agent-runs/:id`. The screen
   never issues a request per agent, and it makes no model call at all - the
   clusters were computed from findings that already existed. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSetCrumb } from "@/lib/shell-crumb";
import { useActiveRepo } from "@/lib/repo-context";
import { MultiAgentResultsView } from "./_components/MultiAgentResultsView";

export default function MultiAgentResultsPage() {
  const t = useTranslations("runs");
  const params = useParams<{ repoId: string; runId: string }>();
  const { repoId, runId } = params;
  const { activeRepo } = useActiveRepo();

  useSetCrumb([
    { label: activeRepo?.full_name ?? repoId },
    { label: t("page.crumb"), href: `/repos/${repoId}/multi-agent` },
    { label: t("page.title") },
  ]);

  return <MultiAgentResultsView repoId={repoId} runId={runId} />;
}
