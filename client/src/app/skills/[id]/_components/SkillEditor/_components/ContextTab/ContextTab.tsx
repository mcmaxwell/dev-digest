/* ContextTab — attach project documents to this skill.

   Every agent that links this skill inherits these documents, which is the
   point: attach once here instead of repeating the attachment on each agent.
   The CONTRIBUTES manifest names what the skill actually contributes — bodies,
   with their token cost — rather than reading like a path list. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { ContextDocList } from "@/components/context-doc-list";
import { useActiveRepo } from "@/lib/repo-context";
import { useProjectDocs, useSetSkillContextDocs, useSkillContext } from "@/lib/hooks/project-context";
import { s } from "./styles";

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("context");
  const { activeRepo } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;

  const { data: context } = useSkillContext(skill.id);
  const { data: list } = useProjectDocs(repoId);
  const setDocs = useSetSkillContextDocs(skill.id);

  const docs = context?.docs ?? [];

  return (
    <div>
      <ContextDocList
        available={list?.docs ?? []}
        attached={docs}
        activeRepoId={repoId}
        hint={t("tab.skillHint")}
        contextHref={repoId ? `/repos/${repoId}/context` : null}
        onChange={(next) => setDocs.mutate({ docs: next })}
      />

      <div style={s.manifest}>
        <div style={s.manifestLabel}>{t("tab.contributes")}</div>
        {docs.length === 0 ? (
          <div style={s.manifestEmpty}>{t("tab.contributesEmpty")}</div>
        ) : (
          docs.map((doc) => (
            <div key={`${doc.repo_id}:${doc.path}`} className="mono" style={s.manifestRow}>
              {t("tab.contributesRow", { path: doc.path, tokens: doc.tokens })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
