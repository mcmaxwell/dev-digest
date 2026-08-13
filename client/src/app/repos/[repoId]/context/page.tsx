/* Project Context — /repos/:repoId/context. Browse the Markdown the imported
   repository carries under its four documentation roots, and read any of it.
   Read-only by construction: the clone is do-not-touch and the GitClient port
   has no write method, so the toolbar carries exactly one action, refresh. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSetCrumb } from "@/lib/shell-crumb";
import { useActiveRepo } from "@/lib/repo-context";
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ProjectContextPage() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();

  useSetCrumb([{ label: activeRepo?.full_name ?? repoId }, { label: t("title") }]);

  return <ProjectContextView repoId={repoId} />;
}
