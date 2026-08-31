/* CiTab - the agent's Continuous Integration tab.

   In this cut the tab is an explanation and one button, because Export to CI
   persists nothing: there is no installation to report, no repo list, and no
   run history. Everything that would need a `ci_installations` row belongs to
   the iteration that opens a pull request. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ExportCiWizard } from "./_components/ExportCiWizard";
import { s } from "./styles";

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const [open, setOpen] = React.useState(false);

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("ciTab.heading")}</h2>
      <p style={s.sub}>{t("ciTab.subtitle")}</p>

      <div style={s.card}>
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
        <Button kind="primary" icon="Workflow" onClick={() => setOpen(true)}>
          {t("ciTab.exportToCi")}
        </Button>
      </div>

      {open && <ExportCiWizard agent={agent} onClose={() => setOpen(false)} />}
    </div>
  );
}
