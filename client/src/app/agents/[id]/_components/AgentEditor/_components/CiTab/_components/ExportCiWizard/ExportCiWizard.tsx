/* ExportCiWizard - turn this agent into files.

   Three steps, not the mockup's four. The mockup put Preview before Configure,
   which means the user reads files generated from defaults and then edits the
   triggers, silently invalidating what they just read. Configuring first and
   previewing what the choices actually produced is the same number of clicks
   and cannot go stale. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Icon, Modal } from "@devdigest/ui";
import type { Agent, CiFile, CiTarget, CiTrigger } from "@devdigest/shared";
import { useCiBundle } from "@/lib/hooks/ci";
import { POST_AS, POST_AS_KEY, TARGETS, TRIGGERS } from "./constants";
import { s } from "./styles";

type PostAs = (typeof POST_AS)[number];

/** Hand one generated file to the browser. Kept out of the component so the
 *  DOM poke is one named place rather than an inline side effect in JSX. */
function downloadFile(file: CiFile) {
  const url = URL.createObjectURL(new Blob([file.contents], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.path.split("/").pop() ?? "devdigest-file.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportCiWizard({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const t = useTranslations("ci");
  const bundle = useCiBundle(agent.id);

  const [step, setStep] = React.useState(0);
  const [target, setTarget] = React.useState<CiTarget>("gha");
  const [triggers, setTriggers] = React.useState<CiTrigger[]>(["opened", "synchronize"]);
  const [postAs, setPostAs] = React.useState<PostAs>("github_review");
  const [selected, setSelected] = React.useState(0);
  const [copied, setCopied] = React.useState<string | null>(null);

  const files = bundle.data?.files ?? [];
  // The workflow is generated first and is what the user came to look at, so it
  // is the file already open when the preview appears (AC-21).
  const current = files[selected] ?? files[0];

  const toggleTrigger = (trig: CiTrigger) =>
    setTriggers((prev) =>
      prev.includes(trig) ? prev.filter((x) => x !== trig) : [...prev, trig],
    );

  const generate = () => {
    setSelected(0);
    bundle.mutate({ target, triggers, post_as: postAs }, { onSuccess: () => setStep(2) });
  };

  const copy = async (file: CiFile) => {
    await navigator.clipboard.writeText(file.contents);
    setCopied(file.path);
    window.setTimeout(() => setCopied((p) => (p === file.path ? null : p)), 1600);
  };

  const stepLabels = [
    t("exportWizard.steps.target"),
    t("exportWizard.steps.configure"),
    t("exportWizard.steps.previewInstall"),
  ];

  return (
    <Modal
      width={880}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agent.name })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {step > 0 && (
            <Button icon="ChevronLeft" onClick={() => setStep(step - 1)}>
              {t("exportWizard.back")}
            </Button>
          )}
          <div style={s.spacer} />
          {step === 0 && (
            <Button kind="primary" iconRight="ArrowRight" onClick={() => setStep(1)}>
              {t("exportWizard.continue")}
            </Button>
          )}
          {step === 1 && (
            <Button
              kind="primary"
              iconRight="ArrowRight"
              disabled={triggers.length === 0}
              loading={bundle.isPending}
              onClick={generate}
            >
              {t("exportWizard.continue")}
            </Button>
          )}
          {step === 2 && (
            <Button kind="primary" icon="Check" onClick={onClose}>
              {t("exportWizard.done")}
            </Button>
          )}
        </div>
      }
    >
      <div style={s.steps}>
        <ExportWizardSteps step={step} labels={stepLabels} />
      </div>

      <div style={s.body}>
        {step === 0 && (
          <div style={s.grid}>
            {TARGETS.map((opt) => {
              const Ico = Icon[opt.icon];
              const on = target === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={!opt.enabled}
                  aria-pressed={on}
                  onClick={() => opt.enabled && setTarget(opt.key)}
                  style={s.tile(on, opt.enabled)}
                >
                  <span style={s.tileHead}>
                    <Ico size={15} />
                    <span style={s.tileName}>{t(`exportWizard.targets.${opt.key}`)}</span>
                    <span style={opt.enabled ? s.tag : s.tagMuted}>
                      {opt.enabled
                        ? t("exportWizard.recommended")
                        : t("exportWizard.unavailable")}
                    </span>
                  </span>
                  <span style={s.tileDesc}>{t(`exportWizard.targets.${opt.key}Desc`)}</span>
                </button>
              );
            })}
          </div>
        )}

        {step === 1 && (
          <>
            <div style={s.label}>{t("exportWizard.triggerLabel")}</div>
            <div style={s.chips}>
              {TRIGGERS.map((trig) => {
                const on = triggers.includes(trig);
                return (
                  <button
                    key={trig}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleTrigger(trig)}
                    style={s.chip(on)}
                  >
                    {on && <Icon.Check size={12} />}
                    {t(`exportWizard.triggers.${trig}`)}
                  </button>
                );
              })}
            </div>
            <div style={s.hint}>{t("exportWizard.triggerHint")}</div>

            <div style={s.label}>{t("exportWizard.postResultsLabel")}</div>
            <div style={s.radios}>
              {POST_AS.map((value) => (
                <label key={value} style={s.radio}>
                  <input
                    type="radio"
                    name="post-as"
                    checked={postAs === value}
                    onChange={() => setPostAs(value)}
                  />
                  {t(`exportWizard.postAs.${POST_AS_KEY[value]}`)}
                </label>
              ))}
            </div>

            {bundle.isError && (
              <div style={s.error} role="alert">
                {t("exportWizard.generateFailed")}
              </div>
            )}
          </>
        )}

        {step === 2 && current && (
          <>
            <div style={s.label}>
              {t("exportWizard.filesToCreate")} · {t("exportWizard.fileCount", { count: files.length })}
            </div>
            <div style={s.noteTop}>
              <Icon.AlertTriangle size={14} />
              <span>
                <span style={s.noteTitle}>{t("exportWizard.placeholderTitle")}</span>{" "}
                {t("exportWizard.placeholderBody")}
              </span>
            </div>
            <div style={s.preview}>
              <div style={s.fileList}>
                {files.map((f, i) => (
                  <button
                    key={f.path}
                    type="button"
                    aria-pressed={i === selected}
                    onClick={() => setSelected(i)}
                    style={s.fileBtn(i === selected)}
                  >
                    {f.path}
                  </button>
                ))}
              </div>
              <div style={s.pane}>
                <div style={s.paneHead}>
                  <span style={s.panePath}>{current.path}</span>
                  <span style={s.paneActions}>
                    <Button size="sm" icon="Copy" onClick={() => void copy(current)}>
                      {copied === current.path
                        ? t("exportWizard.copied")
                        : t("exportWizard.copy")}
                    </Button>
                    <Button size="sm" icon="ArrowDown" onClick={() => downloadFile(current)}>
                      {t("exportWizard.download")}
                    </Button>
                  </span>
                </div>
                {/* Rendered as text, never as HTML or Markdown: a system prompt
                    is untrusted and must be shown, not interpreted. */}
                <pre style={s.code}>{current.contents}</pre>
              </div>
            </div>

            {agent.skill_count === 0 && (
              <div style={s.note}>
                <Icon.Info size={14} />
                <span>{t("exportWizard.noSkillsNote")}</span>
              </div>
            )}

          </>
        )}
      </div>
    </Modal>
  );
}
