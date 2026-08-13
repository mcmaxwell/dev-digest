/* DocViewer — the read-only document pane.

   The rendered body is held in a REF rather than read straight from the query
   cache: when a refetch returns different content for the document the user is
   reading, the text must not swap underneath them. The banner's button is what
   adopts the new version. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { DocMarkdown } from "@/components/doc-markdown";
import { useProjectDoc } from "@/lib/hooks/project-context";
import { s } from "../../styles";

interface DocViewerProps {
  repoId: string;
  path: string | null;
  /** Rendered on a narrow viewport, where the panes collapse to one. */
  onBack?: () => void;
}

export function DocViewer({ repoId, path, onBack }: DocViewerProps) {
  const t = useTranslations("context");
  const { data, isLoading, isError, refetch, isFetching } = useProjectDoc(repoId, path);

  // The text the reader is looking at. A refetch that returns DIFFERENT content
  // for the same document does not replace it — adopting is an explicit act.
  // Adjusted during render (React's "information from previous renders"
  // pattern) rather than in an effect, so there is never a frame showing the
  // wrong document.
  const [current, setCurrent] = React.useState<{ path: string; content: string } | null>(null);
  if (data && (current === null || current.path !== data.path)) {
    setCurrent({ path: data.path, content: data.content });
  }

  const changed =
    !!data && !!current && current.path === data.path && current.content !== data.content;

  const adopt = () => {
    if (data) setCurrent({ path: data.path, content: data.content });
  };

  if (!path) {
    return (
      <div style={s.viewer}>
        <EmptyState icon="FileText" title={t("select")} />
      </div>
    );
  }

  if (isLoading && !current) {
    return (
      <div style={s.viewer}>
        <div style={s.viewerBody}>
          <Skeleton height={18} width="40%" />
          <Skeleton height={12} />
          <Skeleton height={12} />
        </div>
      </div>
    );
  }

  // A per-document failure: the tree selection is untouched and the retry
  // control re-runs only this document's read.
  if (isError && !current) {
    return (
      <div style={s.viewer}>
        <ErrorState title={t("readError", { path })} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div style={s.viewer}>
      <div style={s.viewerHead}>
        {onBack && (
          <Button kind="ghost" icon="ChevronLeft" onClick={onBack}>
            {t("back")}
          </Button>
        )}
        <span className="mono" style={s.viewerPath} title={path}>
          {path}
        </span>
        <span style={s.viewerSpacer} />
        {data && (
          <Badge color="var(--text-muted)">
            {t("usedBy", { count: data.used_by_agents })}
          </Badge>
        )}
        <Button kind="ghost" icon="RefreshCw" onClick={() => void refetch()} loading={isFetching}>
          {t("retry")}
        </Button>
      </div>
      {changed && (
        <div style={s.banner} role="status">
          <span>{t("reload.text")}</span>
          <Button kind="secondary" onClick={adopt}>
            {t("reload.action")}
          </Button>
        </div>
      )}
      <div style={s.viewerBody}>
        <DocMarkdown>{current?.content ?? ""}</DocMarkdown>
      </div>
    </div>
  );
}
