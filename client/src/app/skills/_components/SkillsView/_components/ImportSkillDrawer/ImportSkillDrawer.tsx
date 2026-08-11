/* ImportSkillDrawer — upload a .md/.zip, review the extracted PREVIEW (core
   body + warnings + skipped archive entries), then confirm. Nothing is saved
   before confirmation; the confirmed skill lands disabled, source
   `imported_file`, and its body runs untrusted-wrapped in prompts. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Drawer, FormField, SelectInput, TextInput } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill, useImportSkillPreview } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { SKILL_TYPES } from "../../../SkillFormFields";
import { s } from "./styles";

export function ImportSkillDrawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const preview = useImportSkillPreview();
  const create = useCreateSkill();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");

  const pick = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    preview.mutate(file, {
      onSuccess: (p) => {
        setName(p.name);
        setDescription(p.description);
        setType(p.type ?? "custom");
      },
    });
  };

  const confirm = async () => {
    if (!preview.data) return;
    const skill = await create.mutateAsync({
      name: name.trim() || preview.data.name,
      description,
      type,
      body: preview.data.body,
      source: "imported_file",
      enabled: false,
    });
    toast.success(t("import.success", { name: skill.name }));
    onClose();
  };

  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));
  const p = preview.data;

  return (
    <Drawer
      width={640}
      title={t("import.title")}
      subtitle={t("import.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          <div style={s.footerRight}>
            <Button
              kind="primary"
              icon="Check"
              onClick={confirm}
              disabled={!p || create.isPending}
            >
              {create.isPending ? t("import.importing") : t("import.confirm")}
            </Button>
          </div>
        </div>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.zip"
        style={{ display: "none" }}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <div style={s.pickRow}>
        <Button kind="secondary" icon="Upload" onClick={() => fileRef.current?.click()}>
          {fileName ? t("import.changeFile") : t("import.chooseFile")}
        </Button>
        {fileName && (
          <span className="mono" style={s.fileName}>
            {fileName}
          </span>
        )}
        {preview.isPending && <span style={s.parsing}>{t("import.parsing")}</span>}
      </div>

      {preview.isError && (
        <div style={s.errorBox}>
          {t("import.importFailed")}
          {preview.error instanceof ApiError ? ` — ${preview.error.message}` : ""}
        </div>
      )}

      {p && (
        <>
          <div style={s.previewHead}>{t("import.previewTitle")}</div>
          <div style={s.untrustedNotice}>{t("import.untrustedNotice")}</div>

          {p.warnings.length > 0 && (
            <div style={s.warnBox}>
              <div style={s.listTitle}>{t("import.warningsTitle")}</div>
              {p.warnings.map((w, i) => (
                <div key={i} style={s.listLine}>
                  • {w}
                </div>
              ))}
            </div>
          )}
          {p.skipped_entries.length > 0 && (
            <div style={s.skippedBox}>
              <div style={s.listTitle}>{t("import.skippedTitle")}</div>
              {p.skipped_entries.map((e, i) => (
                <div key={i} className="mono" style={s.listLine}>
                  {e}
                </div>
              ))}
            </div>
          )}

          <FormField label={t("import.fields.name")} required>
            <TextInput value={name} onChange={setName} mono />
          </FormField>
          <FormField label={t("import.fields.description")} hint={t("import.fields.descriptionHint")}>
            <TextInput value={description} onChange={setDescription} />
          </FormField>
          <FormField label={t("import.fields.type")}>
            <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
          </FormField>
          <FormField label={t("import.fields.body")}>
            <pre className="mono" style={s.bodyPre}>
              {p.body}
            </pre>
          </FormField>
        </>
      )}
    </Drawer>
  );
}
