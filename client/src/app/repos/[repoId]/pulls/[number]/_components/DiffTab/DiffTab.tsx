"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { SmartDiffViewer } from "../SmartDiffViewer";
import { OrderToggle } from "../OrderToggle";
import type { DiffOrder } from "../OrderToggle/constants";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Opens a flagged line's finding on the Findings tab. */
  onOpenFinding?: (findingId: string) => void;
  /** Lifted to the URL so the choice survives a trip to another tab. */
  order: DiffOrder;
  onOrderChange: (next: DiffOrder) => void;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  onOpenFinding,
  order,
  onOrderChange,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const plainDiff = <DiffViewer files={files} commenting={commenting} />;

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {t(showComments ? "files.hideComments" : "files.showComments", {
                  count: commentCount,
                })}
              </Button>
            )}
            <OrderToggle value={order} onChange={onOrderChange} />
          </div>
        }
      >
        {order === "smart" ? t("smartDiff.sectionLabel") : t("files.heading", { count: filesCount })}
      </SectionLabel>
      {order === "smart" ? (
        <SmartDiffViewer
          prId={prId}
          files={files}
          commenting={commenting}
          onUnavailable={plainDiff}
          onOpenFinding={onOpenFinding}
        />
      ) : (
        plainDiff
      )}
    </section>
  );
}
