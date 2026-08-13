/* ProjectContextView — two panes: a document tree and a read-only viewer.

   Below NARROW_VIEWPORT_PX the panes collapse to tree-then-viewer with a back
   control. The toolbar carries exactly one action, refresh — this feature
   creates, edits, uploads, renames and deletes nothing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { useProjectDocs, useRefreshProjectDocs } from "@/lib/hooks/project-context";
import { DocTree } from "./_components/DocTree";
import { DocViewer } from "./_components/DocViewer";
import { NARROW_VIEWPORT_PX } from "./constants";
import { formatCount, relativeTime } from "./helpers";
import { s } from "./styles";

/** Tracks the sub-900px breakpoint. Media queries are the external system. */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${NARROW_VIEWPORT_PX - 1}px)`);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const { data, isLoading, isError, refetch } = useProjectDocs(repoId);
  const refresh = useRefreshProjectDocs();
  const narrow = useNarrowViewport();
  const [selected, setSelected] = React.useState<string | null>(null);

  if (isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton height={16} width="30%" />
        <Skeleton height={12} />
        <Skeleton height={12} />
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorState title={t("loadError")} onRetry={() => void refetch()} />;
  }

  const { docs, scan } = data;

  // The clone is the prerequisite for everything on this page, so say so
  // instead of rendering an empty tree.
  if (scan.status === "not_cloned") {
    return <EmptyState icon="Database" title={t("notCloned.title")} body={t("notCloned.body")} />;
  }

  if (docs.length === 0) {
    return (
      <EmptyState
        icon="FileText"
        title={t("empty.title")}
        body={
          <>
            {t("empty.globs")}
            {scan.status === "error" && scan.error && (
              <div style={{ marginTop: 8 }}>{t("scanFailed", { error: scan.error })}</div>
            )}
          </>
        }
      />
    );
  }

  const scanned = relativeTime(scan.scanned_at);
  const showTree = !narrow || selected === null;
  const showViewer = !narrow || selected !== null;

  return (
    <div style={s.wrap}>
      <div style={s.panes(narrow)}>
        {showTree && (
          <div style={s.tree}>
            <div style={s.toolbar}>
              <span style={s.toolbarTitle}>{t("title")}</span>
              <Button
                kind="secondary"
                icon="RefreshCw"
                onClick={() => refresh.mutate(repoId)}
                loading={refresh.isPending}
              >
                {refresh.isPending ? t("refreshing") : t("refresh")}
              </Button>
            </div>

            <DocTree
              docs={docs}
              selected={selected}
              onSelect={setSelected}
              label={t("treeLabel")}
            />

            <div style={s.footer}>
              <span>
                {t("footer", {
                  count: scan.doc_count,
                  tokens: formatCount(scan.tokens_total),
                  scanned: scanned ? t("scannedAt", { when: scanned }) : t("neverScanned"),
                })}
              </span>
              {scan.skipped_too_large > 0 && (
                <span>{t("skipped", { count: scan.skipped_too_large })}</span>
              )}
              {scan.bounded > 0 && <span>{t("bounded", { count: scan.bounded })}</span>}
              {scan.status === "error" && scan.error && (
                <span>{t("scanFailed", { error: scan.error })}</span>
              )}
            </div>
          </div>
        )}

        {showViewer && (
          <DocViewer
            repoId={repoId}
            path={selected}
            {...(narrow ? { onBack: () => setSelected(null) } : {})}
          />
        )}
      </div>
    </div>
  );
}
