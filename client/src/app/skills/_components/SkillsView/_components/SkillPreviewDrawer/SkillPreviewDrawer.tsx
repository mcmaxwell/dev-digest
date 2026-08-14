/* SkillPreviewDrawer — side preview + inline editor for one skill: name,
   directive description, type, markdown body (versioned), enabled toggle.
   Mount with key={skill.id} so switching skills remounts fresh form state. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useDeleteSkill, useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { SkillFormFields, typeColor, type SkillForm } from "../../../SkillFormFields";
import { s } from "./styles";

export function SkillPreviewDrawer({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const [form, setForm] = React.useState<SkillForm>({
    name: skill.name,
    description: skill.description,
    type: skill.type,
    body: skill.body,
    enabled: skill.enabled,
  });
  const set = <K extends keyof SkillForm>(key: K) => (value: SkillForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const untrusted = skill.source !== "manual";

  const save = () =>
    update.mutate(
      { id: skill.id, patch: form },
      { onSuccess: (data) => toast.success(t("preview.saved", { version: data.version })) },
    );

  const remove = () => {
    if (!window.confirm(t("preview.deleteConfirm", { name: skill.name }))) return;
    del.mutate(skill.id, { onSuccess: onClose });
  };

  return (
    <Drawer
      width={640}
      title={
        <span style={s.titleRow}>
          <span className="mono">{skill.name}</span>
          <Badge color={typeColor(skill.type)}>{t(`listItem.type.${skill.type}`)}</Badge>
          <Badge color="var(--text-muted)" mono>
            {t("preview.version", { version: skill.version })}
          </Badge>
          {untrusted && (
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("preview.untrustedBadge")}
            </Badge>
          )}
        </span>
      }
      subtitle={t(`listItem.source.${skill.source}`)}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" icon="Trash" onClick={remove} disabled={del.isPending}>
            {t("preview.delete")}
          </Button>
          <Button
            kind="secondary"
            icon="ExternalLink"
            onClick={() => router.push(`/skills/${skill.id}`)}
          >
            {t("detail.openEditor")}
          </Button>
          <div style={s.footerRight}>
            <label style={s.enabledLabel}>
              {form.enabled ? t("preview.enabled") : t("preview.disabled")}
              <Toggle on={form.enabled} onChange={set("enabled")} size={16} />
            </label>
            <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
              {update.isPending ? t("preview.saving") : t("preview.save")}
            </Button>
          </div>
        </div>
      }
    >
      {untrusted && <div style={s.untrustedNotice}>{t("preview.untrustedNotice")}</div>}
      <SkillFormFields form={form} onChange={set} />
    </Drawer>
  );
}
