/* ConfigTab — the skill's editable configuration: the shared form fields plus
   enabled toggle, save (a changed body creates a new immutable version) and
   delete. Mount with key={skill.id} so switching skills remounts fresh state. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useDeleteSkill, useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { SkillFormFields, type SkillForm } from "../../../../../_components/SkillFormFields";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill: Skill }) {
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
    del.mutate(skill.id, { onSuccess: () => router.push("/skills") });
  };

  return (
    <div style={s.wrap}>
      {untrusted && <div style={s.untrustedNotice}>{t("preview.untrustedNotice")}</div>}
      <SkillFormFields form={form} onChange={set} bodyRows={18} />
      <div style={s.actions}>
        <Button kind="ghost" icon="Trash" onClick={remove} disabled={del.isPending}>
          {t("preview.delete")}
        </Button>
        <div style={s.actionsRight}>
          <label style={s.enabledLabel}>
            {form.enabled ? t("preview.enabled") : t("preview.disabled")}
            <Toggle on={form.enabled} onChange={set("enabled")} size={16} />
          </label>
          <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
            {update.isPending ? t("preview.saving") : t("preview.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
