/* Create-skill modal fed by the accepted conventions.

   The server renders the markdown draft (rules + their grounded evidence); this
   modal is the editing surface before anything is persisted. Saving goes
   through the ordinary POST /skills, so an extracted skill is versioned,
   editable and linkable exactly like a hand-written one. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  TextInput,
  Textarea,
  Toggle,
} from "@devdigest/ui";
import type { ConventionCandidate, SkillType } from "@devdigest/shared";
import { useAgents, useSetAgentSkills, useAgentSkills } from "@/lib/hooks/agents";
import { useConventionSkillDraft } from "@/lib/hooks/conventions";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { CREATE_MODAL_WIDTH, SKILL_TYPES } from "../../constants";
import { s } from "./styles";

export interface CreateSkillFromConventionsModalProps {
  repoId: string;
  repoName: string;
  accepted: ConventionCandidate[];
  onClose: () => void;
}

export function CreateSkillFromConventionsModal({
  repoId,
  repoName,
  accepted,
  onClose,
}: CreateSkillFromConventionsModalProps) {
  const t = useTranslations("conventions");
  const tSkills = useTranslations("skills");
  const toast = useToast();

  const draftMutation = useConventionSkillDraft(repoId);
  const createSkill = useCreateSkill();
  const { data: agents } = useAgents();
  const setAgentSkills = useSetAgentSkills();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [agentId, setAgentId] = React.useState("");

  // Existing links for the chosen agent — appending must not drop them.
  const { data: existingLinks } = useAgentSkills(agentId || null);

  // Keyed on the id SET, not the array: the parent recomputes `accepted` with a
  // fresh identity on unrelated re-renders (poll ticks, toasts), and re-running
  // this effect would re-render the draft and silently wipe the user's edits.
  const idsKey = accepted.map((c) => c.id).join(",");
  const { mutateAsync: renderDraft } = draftMutation;

  React.useEffect(() => {
    let cancelled = false;
    const candidateIds = idsKey ? idsKey.split(",") : [];
    void renderDraft({ candidateIds, mode: "merged" }).then((drafts) => {
      const first = drafts[0];
      if (cancelled || !first) return;
      setName(first.name);
      setDescription(first.description);
      setType(first.type);
      setBody(first.body);
    });
    return () => {
      cancelled = true;
    };
  }, [renderDraft, idsKey]);

  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: tSkills(`create.types.${v}`) }));
  const agentOptions = [
    { value: "", label: t("modal.linkAgentNone") },
    ...(agents ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const canSubmit = name.trim().length > 0 && body.trim().length > 0 && !createSkill.isPending;

  const submit = async () => {
    try {
      const skill = await createSkill.mutateAsync({
        name: name.trim(),
        description,
        type,
        body,
        source: "extracted",
        enabled,
      });
      if (agentId) {
        const current = (existingLinks ?? []).map((l) => l.skill_id);
        await setAgentSkills.mutateAsync({
          agentId,
          skillIds: [...current.filter((id) => id !== skill.id), skill.id],
        });
      }
      toast.success(t("modal.created", { name: skill.name }));
      onClose();
    } catch {
      toast.error(t("modal.failed"));
    }
  };

  return (
    <Modal
      width={CREATE_MODAL_WIDTH}
      title={t("modal.title")}
      subtitle={name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button kind="primary" icon="Sparkles" onClick={submit} disabled={!canSubmit}>
            {createSkill.isPending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.notice}>
          <Icon.Sparkles size={15} style={s.noticeIcon} />
          <span>{t("modal.mergedFrom", { count: accepted.length, repo: repoName })}</span>
        </div>

        {draftMutation.isPending && <div style={s.error}>{t("modal.loading")}</div>}
        {draftMutation.isError && <div style={s.error}>{t("modal.draftFailed")}</div>}

        <FormField label={t("modal.name")} required>
          <TextInput value={name} onChange={setName} mono />
        </FormField>
        <FormField label={t("modal.description")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>

        <div style={s.row}>
          <div style={s.rowItem}>
            <FormField label={t("modal.type")}>
              <SelectInput
                value={type}
                onChange={(v) => setType(v as SkillType)}
                options={typeOptions}
              />
            </FormField>
          </div>
          <div style={s.rowItem}>
            <FormField label={t("modal.enabled")} hint={t("modal.enabledHint")}>
              <Toggle on={enabled} onChange={setEnabled} />
            </FormField>
          </div>
        </div>

        <FormField label={t("modal.linkAgent")} hint={t("modal.linkAgentHint")}>
          <SelectInput value={agentId} onChange={setAgentId} options={agentOptions} />
        </FormField>

        <FormField label={t("modal.body")} hint={t("modal.bodyHint")} required>
          <div style={s.bodyHeader}>
            <Icon.FileText size={12} />
            <span className="mono" style={s.filename}>
              {name || "skill"}.md
            </span>
            <Badge color="var(--text-muted)">{t("modal.unsaved")}</Badge>
          </div>
          <Textarea value={body} onChange={setBody} rows={14} mono />
        </FormField>
      </div>
    </Modal>
  );
}
