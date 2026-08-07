/* SmartDiffViewer (L03) — the Files-changed tab in reviewer order: the PR's
   files grouped core / wiring / boilerplate, boilerplate collapsed, and every
   file the last review flagged expanded with its finding lines marked. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@devdigest/shared";
import { FileCard, type DiffCommentApi } from "@/components/diff-viewer";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { usePrReviews } from "@/lib/hooks/reviews";
import { AUTO_OPEN_ROLES } from "./constants";
import { flagsFor, severityByPath, toPrFiles } from "./helpers";
import { s } from "./styles";
import { GroupSection } from "./_components/GroupSection";
import { SplitBanner } from "./_components/SplitBanner";

export function SmartDiffViewer({
  prId,
  files,
  commenting,
  onUnavailable,
}: {
  prId: string | null;
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** Rendered instead of an error state — the plain diff is always a valid fallback. */
  onUnavailable?: React.ReactNode;
}) {
  const t = useTranslations("prReview.smartDiff");
  const { data, isLoading, isError } = useSmartDiff(prId);
  // Already in cache: the PR page fetches reviews for the Agent-runs tab, so
  // this is a cache read, not a second request.
  const { data: reviews } = usePrReviews(prId);

  const severities = React.useMemo(() => severityByPath(reviews), [reviews]);

  if (isLoading) return <div style={s.status}>{t("loading")}</div>;
  // Grouping is a nicety; losing it must never cost the user the diff itself.
  if (isError || !data) {
    return (
      <>
        <div style={s.status}>{t("error")}</div>
        {onUnavailable}
      </>
    );
  }

  return (
    <div style={s.wrap}>
      <SplitBanner suggestion={data.split_suggestion} />
      {data.groups.map((group) => {
        const entries = toPrFiles(group.files, files);
        if (entries.length === 0) return null;
        return (
          <GroupSection key={group.role} role={group.role} fileCount={entries.length}>
            {entries.map(({ entry, file }) => (
              <FileCard
                key={entry.path}
                file={file}
                commenting={commenting}
                flags={flagsFor(entry, severities)}
                // A flagged file opens whatever its role: a finding in a lock
                // file is exactly the one boilerplate change worth reading.
                defaultOpen={
                  entry.finding_lines.length > 0 || AUTO_OPEN_ROLES.includes(group.role)
                }
              />
            ))}
          </GroupSection>
        );
      })}
    </div>
  );
}
