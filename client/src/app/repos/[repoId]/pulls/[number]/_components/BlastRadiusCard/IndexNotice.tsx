"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastIndexState } from "@devdigest/shared";
import { s } from "./styles";

/**
 * The partial-index banner.
 *
 * This component IS the "an empty list must never be mistaken for a fact"
 * requirement, rendered. The server sends a machine-readable `reason` and the
 * client turns it into a sentence through next-intl - the same shape
 * `intent.status.*` already uses - because a sentence composed on the server
 * cannot be translated.
 *
 * Only `partial` renders here. `ok` needs no banner, and `degraded` is a whole
 * empty state with a call to action rather than a note above real data.
 */
export function IndexNotice({ index }: { index: BlastIndexState }) {
  const t = useTranslations("blast");
  if (index.status !== "partial") return null;

  return (
    <div style={s.notice} role="status">
      <span style={s.noticeTitle}>{t("index.partialTitle")}</span>{" "}
      {t(`index.${index.reason}`)}
    </div>
  );
}
