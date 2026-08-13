/* ContextTab — attach project documents to this agent and order them.

   Order is load-bearing: array position is the position of the document's
   block in the assembled prompt. Every change persists immediately via
   PUT /agents/:id/context, which does NOT version the agent (per the spec's
   non-goals) — reproducibility rests on the per-run trace instead. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Agent } from "@devdigest/shared";
import { ContextDocList } from "@/components/context-doc-list";
import { useActiveRepo } from "@/lib/repo-context";
import { useAgentContext, useSetAgentContextDocs, useProjectDocs } from "@/lib/hooks/project-context";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("context");
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;

  const { data: context } = useAgentContext(agent.id, repoId);
  const { data: list } = useProjectDocs(repoId);
  const setDocs = useSetAgentContextDocs(agent.id, repoId);

  return (
    <ContextDocList
      available={list?.docs ?? []}
      attached={context?.direct ?? []}
      inherited={context?.inherited ?? []}
      activeRepoId={repoId}
      orderable
      hint={t("tab.orderHint")}
      contextHref={repoId ? `/repos/${repoId}/context` : null}
      onChange={(docs) => setDocs.mutate({ docs })}
    />
  );
}
