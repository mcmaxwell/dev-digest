"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MonoLink } from "@devdigest/ui";
import type { RankedBlastCaller } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

interface CallerRowProps {
  caller: RankedBlastCaller;
  repoFullName: string | null;
  /**
   * The commit the INDEX was built from - NOT the PR head.
   *
   * Caller lines come out of the index, which is built from the repository's
   * default branch, so `src/server.ts:30` is a fact about that commit. Linking
   * to the PR head would point at a line number that may not exist there, and
   * these files are not in the PR, so there is no internal diff view to send the
   * reader to instead. A GitHub blob at the indexed commit is the only correct
   * target.
   */
  indexedSha: string;
}

/**
 * One `file:line in symbol` row, and the single place the link decision is made.
 *
 * `MonoLink` WITHOUT an `href` renders an inert `<button>` with
 * `cursor: pointer` - something that looks clickable and does nothing - and
 * `src/vendor/ui/**` is do-not-touch, so the fix belongs here: when there is no
 * repo full name or no indexed commit, this renders a `<span>` with a title, and
 * never a button.
 */
export function CallerRow({ caller, repoFullName, indexedSha }: CallerRowProps) {
  const t = useTranslations("blast");
  const label = `${caller.file}:${caller.line}`;
  const canLink = Boolean(repoFullName) && Boolean(indexedSha);

  return (
    <li style={s.callerRow}>
      {canLink ? (
        <MonoLink href={githubBlobUrl(repoFullName!, indexedSha, caller.file, caller.line)}>
          {label}
        </MonoLink>
      ) : (
        <span style={s.inertLocation} title={t("linkUnavailable")}>
          {label}
        </span>
      )}
      <span style={s.callerSymbol}>{caller.name}</span>
    </li>
  );
}
