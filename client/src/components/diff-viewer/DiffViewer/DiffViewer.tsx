/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "@/components/diff-viewer/comments";
import { s } from "@/components/diff-viewer/styles";
import { FileCard } from "@/components/diff-viewer/FileCard";

export function DiffViewer({
  files,
  commenting,
  focusFile,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** A path to open expanded and scroll to, from the `?file=` param. */
  focusFile?: string | null;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f) => (
        <FileCard
          key={f.path}
          file={f}
          commenting={commenting}
          focusPath={focusFile}
        />
      ))}
    </div>
  );
}
