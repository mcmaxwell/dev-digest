/* /skills/:id — Skill Editor page: Configuration + Statistics + Version
   history tabs over one skill. Tab state lives in ?tab=. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useSetCrumb } from "@/lib/shell-crumb";
import { useSkill } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { typeColor } from "../_components/SkillFormFields";
import { SkillEditor } from "./_components/SkillEditor";

/** Must stay in step with `SkillEditor/constants.ts` TABS — a key missing here
    is silently normalised back to "config", so the tab can never be opened. */
const VALID_TABS = ["config", "stats", "history", "context"];

export default function SkillEditorPage() {
  const t = useTranslations("skills");
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { id } = params;

  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  useSetCrumb([
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: skill?.name ?? t("detail.crumbSkill") },
  ]);

  if (isError || (!isLoading && !skill)) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <ErrorState
        fullScreen
        title={notFound ? t("detail.notFound.title") : t("detail.loadError")}
        body={
          notFound
            ? t("detail.notFound.body")
            : error instanceof ApiError
              ? error.message
              : undefined
        }
        onRetry={() => refetch()}
      />
    );
  }

  if (isLoading || !skill) {
    return (
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton height={24} width={240} />
        <Skeleton height={200} />
      </div>
    );
  }

  const untrusted = skill.source !== "manual";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 52px)" }}>
      <div style={{ padding: "14px 28px 0", flexShrink: 0 }}>
        <Button kind="ghost" size="sm" onClick={() => router.push("/skills")}>
          {t("detail.back")}
        </Button>
      </div>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 28px 0", flexShrink: 0 }}
      >
        <Icon.Sparkles size={18} style={{ color: "var(--accent)" }} />
        <h1 className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
          {skill.name}
        </h1>
        <Badge color={typeColor(skill.type)}>{t(`listItem.type.${skill.type}`)}</Badge>
        <Badge color="var(--text-muted)" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        {untrusted && (
          <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
            {t("preview.untrustedBadge")}
          </Badge>
        )}
        {!skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <SkillEditor skill={skill} tab={tab} onTab={setTab} />
      </div>
    </div>
  );
}
