"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
}

export function OverviewTab({ prId, prBody }: OverviewTabProps) {
  const t = useTranslations("brief");
  return (
    <>
      {/* Intent sits ABOVE the description: it is derived FROM the description,
          and the reader should verify the machine's reading first. */}
      <IntentCard prId={prId} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
