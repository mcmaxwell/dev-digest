/* CiTab - the agent's Continuous Integration tab.

   Two states over one card. With no `ci_installations` row the tab is an
   explanation and one button, because there is genuinely nothing to report;
   with rows it becomes the count and the repository list, which is the state
   the mockup describes and the earlier cut could not honestly show.

   "Fail CI on" is a SECOND VIEW of `agents.ci_fail_on`, not a second piece of
   state: the Config tab writes the same field through the same
   `useUpdateAgent` hook, so a change made here shows up there and vice versa.
   Two controls over one field is fine; two copies of the value would not be. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, SelectInput } from "@devdigest/ui";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { useCiInstallations } from "@/lib/hooks/ci";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { ExportCiWizard } from "./_components/ExportCiWizard";
import { s } from "./styles";

/** The gate policy, in order of severity. Declared here rather than imported
 *  from the Config tab: a sibling feature's internals are not shared code. */
const CI_FAIL_ON_VALUES = ["never", "critical", "warning", "any"] as const;

/** Installation dates are read at a glance, so the date alone is enough. */
const asDate = (iso: string) => new Date(iso).toLocaleDateString();

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const tAgents = useTranslations("agents");
  const [open, setOpen] = React.useState(false);

  const installations = useCiInstallations(agent.id);
  const update = useUpdateAgent();
  const installed = installations.data ?? [];

  // The option LABELS come from the agents namespace on purpose: they name the
  // same four values the Config tab names, and one copy of that wording is the
  // point of pointing both controls at one field.
  const failOnOptions = CI_FAIL_ON_VALUES.map((v) => ({
    value: v,
    label: tAgents(`config.ciFailOnOptions.${v}`),
  }));

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("ciTab.heading")}</h2>
      <p style={s.sub}>{t("ciTab.subtitle")}</p>

      <div style={s.card}>
        {installed.length > 0 ? (
          <>
            <div style={s.activeIn}>{t("ciTab.activeIn", { count: installed.length })}</div>
            <ul style={s.repos}>
              {installed.map((i) => (
                <li key={i.id} style={s.repo}>
                  <Icon.Workflow size={13} />
                  <span style={s.repoName}>{i.repo}</span>
                  <span style={s.repoDate}>
                    {t("ciTab.installed", { date: asDate(i.installed_at) })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p style={s.explainer}>{t("ciTab.explainer")}</p>
            <ul style={s.points}>
              {(["pointNoWrite", "pointNoState"] as const).map((k) => (
                <li key={k} style={s.point}>
                  <span style={s.pointIcon}>
                    <Icon.Info size={13} />
                  </span>
                  <span>{t(`ciTab.${k}`)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <Button kind="primary" icon="Workflow" onClick={() => setOpen(true)}>
          {t("ciTab.exportToCi")}
        </Button>
      </div>

      <div style={s.gateCard}>
        <FormField label={t("ciTab.failOnLabel")} hint={t("ciTab.failOnHint")}>
          <SelectInput
            value={agent.ci_fail_on}
            onChange={(v) =>
              update.mutate({ id: agent.id, patch: { ci_fail_on: v as CiFailOn } })
            }
            options={failOnOptions}
          />
        </FormField>
        {update.isPending && <div style={s.saving}>{t("ciTab.failOnSaving")}</div>}
      </div>

      {open && <ExportCiWizard agent={agent} onClose={() => setOpen(false)} />}
    </div>
  );
}
