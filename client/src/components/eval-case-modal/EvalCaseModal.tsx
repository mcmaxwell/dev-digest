/* EvalCaseModal — author or edit one eval case.

   The two halves are the input (a unified diff, previewed through the same
   FileCard the PR view uses) and the assertion (expectations as file + line
   range). Expectations are edited as rows rather than raw JSON because the
   matcher only ever reads four fields, and a JSON blob invites typing a fifth
   that silently does nothing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, IconBtn, Modal, SelectInput, TextInput } from "@devdigest/ui";
import type { EvalCaseRecord, EvalExpectation, PrFile } from "@devdigest/shared";
import { FileCard } from "@/components/diff-viewer";
import { useCreateEvalCase, useUpdateEvalCase } from "@/lib/hooks/eval";
import { s } from "./styles";

/**
 * Turn the pasted diff into the `PrFile[]` the viewer renders.
 *
 * Deliberately a display-only split on `diff --git`: the authoritative parse is
 * the server's, and a second parser here that disagreed with it would preview
 * something the run never sees.
 */
function filesFromDiff(diff: string, unknownLabel: string): PrFile[] {
  return diff
    .split(/^diff --git /m)
    .map((chunk, i) => (i === 0 && !diff.startsWith("diff --git") ? chunk : `diff --git ${chunk}`))
    .filter((chunk) => chunk.trim().length > 0)
    .map((patch) => {
      const path = /\+\+\+ b\/(.+)/.exec(patch)?.[1]?.trim() ?? unknownLabel;
      const lines = patch.split("\n");
      return {
        path,
        additions: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
        deletions: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
        patch,
      };
    });
}

const emptyExpectation = (file: string): EvalExpectation => ({
  kind: "must_find",
  file,
  start_line: 1,
  end_line: 1,
});

export function EvalCaseModal({
  agentId,
  evalCase,
  onClose,
  initial,
}: {
  agentId: string;
  evalCase: EvalCaseRecord | null;
  onClose: () => void;
  /** Prefill for a case minted from a finding. */
  initial?: { name: string; input_diff: string; expectations: EvalExpectation[]; notes?: string };
}) {
  const t = useTranslations("eval");
  const create = useCreateEvalCase(agentId);
  const update = useUpdateEvalCase(agentId);

  const [name, setName] = React.useState(evalCase?.name ?? initial?.name ?? "");
  const [notes, setNotes] = React.useState(evalCase?.notes ?? initial?.notes ?? "");
  const [diff, setDiff] = React.useState(evalCase?.input_diff ?? initial?.input_diff ?? "");
  const [expectations, setExpectations] = React.useState<EvalExpectation[]>(
    evalCase?.expectations ?? initial?.expectations ?? [],
  );
  const [error, setError] = React.useState<string | null>(null);

  const files = React.useMemo(
    () => filesFromDiff(diff, t("caseEditor.unknownFile")),
    [diff, t],
  );
  const saving = create.isPending || update.isPending;
  const canSave = name.trim().length > 0 && files.length > 0 && !saving;

  const patch = (i: number, next: Partial<EvalExpectation>) =>
    setExpectations((prev) => prev.map((e, j) => (j === i ? { ...e, ...next } : e)));

  async function save() {
    setError(null);
    const body = {
      name: name.trim(),
      input_diff: diff,
      expected_output: { expectations },
      notes: notes.trim() || null,
    };
    try {
      if (evalCase) await update.mutateAsync({ id: evalCase.id, patch: body });
      else await create.mutateAsync(body);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal
      width={980}
      title={evalCase ? t("caseEditor.caseTitle", { name: evalCase.name }) : t("caseEditor.newCase")}
      subtitle={t("caseEditor.expectedOutput")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {error && <span style={s.err}>{error}</span>}
          <div style={s.footerRight}>
            <Button kind="ghost" onClick={onClose}>
              {t("caseEditor.cancel")}
            </Button>
            <Button kind="primary" icon="Check" disabled={!canSave} loading={saving} onClick={save}>
              {saving ? t("caseEditor.saving") : t("caseEditor.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        {/* ---- input ---- */}
        <div style={s.col}>
          <div>
            <label style={s.label}>{t("caseEditor.nameLabel")}</label>
            <TextInput
              value={name}
              onChange={setName}
              placeholder={t("caseEditor.namePlaceholder")}
              mono
            />
          </div>
          <div>
            <label style={s.label}>{t("caseEditor.notesLabel")}</label>
            <TextInput
              value={notes}
              onChange={setNotes}
              placeholder={t("caseEditor.notesPlaceholder")}
            />
          </div>
          <div>
            <label style={s.label}>{t("caseEditor.inputLabel")}</label>
            <textarea
              value={diff}
              onChange={(e) => setDiff(e.target.value)}
              placeholder={t("caseEditor.diffPlaceholder")}
              style={s.diff}
              aria-label={t("caseEditor.inputLabel")}
            />
            {diff.trim().length > 0 && files.length === 0 && (
              <div style={s.warn}>{t("caseEditor.diffRequired")}</div>
            )}
          </div>
        </div>

        {/* ---- assertion ---- */}
        <div style={s.col}>
          <div>
            <label style={s.label}>{t("caseEditor.preview")}</label>
            {files.length > 0 ? (
              <div style={s.preview}>
                {files.map((f) => (
                  <FileCard key={f.path} file={f} defaultOpen />
                ))}
              </div>
            ) : (
              <div style={s.hint}>{t("caseEditor.diffRequired")}</div>
            )}
          </div>

          <div>
            <label style={s.label}>{t("caseEditor.expectations")}</label>
            {expectations.length === 0 ? (
              <div style={s.hint}>{t("caseEditor.noExpectations")}</div>
            ) : (
              <div style={s.expList}>
                {expectations.map((e, i) => (
                  <div key={i} style={s.expRow}>
                    <SelectInput
                      value={e.kind}
                      onChange={(v) => patch(i, { kind: v as EvalExpectation["kind"] })}
                      options={[
                        { value: "must_find", label: t("caseEditor.kindMustFind") },
                        { value: "must_not_flag", label: t("caseEditor.kindMustNotFlag") },
                      ]}
                    />
                    <TextInput
                      value={e.file}
                      onChange={(v) => patch(i, { file: v })}
                      placeholder={t("caseEditor.fileLabel")}
                      mono
                      aria-label={t("caseEditor.fileLabel")}
                    />
                    <TextInput
                      value={String(e.start_line)}
                      onChange={(v) => patch(i, { start_line: Number(v) || 1 })}
                      mono
                      aria-label={t("caseEditor.startLineLabel")}
                    />
                    <TextInput
                      value={String(e.end_line)}
                      onChange={(v) => patch(i, { end_line: Number(v) || 1 })}
                      mono
                      aria-label={t("caseEditor.endLineLabel")}
                    />
                    <IconBtn
                      icon="X"
                      label={t("caseEditor.removeExpectation")}
                      onClick={() => setExpectations((prev) => prev.filter((_, j) => j !== i))}
                    />
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <Button
                kind="secondary"
                size="sm"
                icon="Plus"
                onClick={() =>
                  setExpectations((prev) => [...prev, emptyExpectation(files[0]?.path ?? "")])
                }
              >
                {t("caseEditor.addExpectation")}
              </Button>
            </div>
            <div style={s.hint}>
              <Icon.Info size={12} /> {t("caseEditor.mustFindHint")}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
