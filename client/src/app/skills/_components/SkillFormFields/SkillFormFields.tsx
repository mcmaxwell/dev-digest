/* SkillFormFields — the shared skill form (name, directive description, type,
   markdown body). Rendered by the /skills preview drawer and the /skills/:id
   Config tab so both editors stay in lockstep on the editable fields. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { SKILL_TYPES } from "./constants";

export interface SkillForm {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled: boolean;
}

export function SkillFormFields({
  form,
  onChange,
  bodyRows = 16,
}: {
  form: SkillForm;
  onChange: <K extends keyof SkillForm>(key: K) => (value: SkillForm[K]) => void;
  bodyRows?: number;
}) {
  const t = useTranslations("skills");
  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));
  return (
    <>
      <FormField label={t("preview.nameLabel")} required>
        <TextInput value={form.name} onChange={onChange("name")} mono />
      </FormField>
      <FormField label={t("preview.descriptionLabel")} hint={t("preview.descriptionHint")}>
        <TextInput value={form.description} onChange={onChange("description")} />
      </FormField>
      <FormField label={t("preview.typeLabel")}>
        <SelectInput
          value={form.type}
          onChange={(v) => onChange("type")(v as SkillType)}
          options={typeOptions}
        />
      </FormField>
      <FormField label={t("preview.bodyLabel")} hint={t("preview.bodyHint")}>
        <Textarea value={form.body} onChange={onChange("body")} rows={bodyRows} mono />
      </FormField>
    </>
  );
}
