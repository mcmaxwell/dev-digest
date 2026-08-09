/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SEV, SeverityBadge } from "@devdigest/ui";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "@/components/diff-viewer/comments";
import { type FindingFlag, type Line } from "@/components/diff-viewer/helpers";
import { s, lineRowFor, lineSignFor } from "@/components/diff-viewer/styles";
import { CommentThreadView } from "@/components/diff-viewer/CommentThreadView";
import { InlineComposer } from "@/components/diff-viewer/InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  flag,
  onOpenFinding,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** A review finding anchored to this line (Smart Diff). */
  flag?: FindingFlag;
  /** Opens that finding on the Findings tab. Omit to render the mark inert. */
  onOpenFinding?: (findingId: string) => void;
}) {
  const t = useTranslations("shell");
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        style={lineRowFor(ln.kind, flag && SEV[flag.severity].c)}
        data-flagged={flag ? "true" : undefined}
      >
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {/* Icon + label, never colour alone — the rail is a duplicate cue.
            When the finding is resolvable the mark is a button that opens it on
            the Findings tab; otherwise it stays inert rather than looking
            clickable and doing nothing. */}
        {flag &&
          (flag.findingId && onOpenFinding ? (
            <button
              type="button"
              onClick={() => onOpenFinding(flag.findingId!)}
              // The label COMPOSES the severity rather than replacing it: an
              // aria-label overrides the badge's visible "Critical" text in the
              // accessible-name computation, which would strip the very cue the
              // icon+label pairing exists to provide — and leave every mark in
              // the diff announcing an identical, undistinguishable name.
              title={t("diffViewer.openFinding", {
                severity: SEV[flag.severity].label,
                line: ln.newNo ?? ln.oldNo ?? 0,
              })}
              aria-label={t("diffViewer.openFinding", {
                severity: SEV[flag.severity].label,
                line: ln.newNo ?? ln.oldNo ?? 0,
              })}
              style={s.flagBtn}
            >
              <SeverityBadge severity={flag.severity} />
            </button>
          ) : (
            <SeverityBadge severity={flag.severity} />
          ))}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
