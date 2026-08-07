/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, type Severity } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "@/components/diff-viewer/constants";
import { parsePatch, type Line } from "@/components/diff-viewer/helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "@/components/diff-viewer/comments";
import { s, chevronFor } from "@/components/diff-viewer/styles";
import { CodeLine } from "@/components/diff-viewer/CodeLine";
import { OutdatedComments } from "@/components/diff-viewer/OutdatedComments";

/** Worst-first, so a file's badge reports its most serious finding. */
const SEVERITY_RANK: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION", "INFO"];

function worstSeverity(flags: ReadonlyMap<number, Severity> | undefined): Severity | null {
  if (!flags?.size) return null;
  const present = new Set(flags.values());
  return SEVERITY_RANK.find((sev) => present.has(sev)) ?? null;
}

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  flags,
  defaultOpen,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** New-side line number → severity of the finding on it (Smart Diff). */
  flags?: ReadonlyMap<number, Severity>;
  /** Overrides the size heuristic below — Smart Diff decides per role. */
  defaultOpen?: boolean;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    defaultOpen ?? (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  const findingCount = flags?.size ?? 0;

  // `open` is seeded once at mount, and the card's key is the stable file path,
  // so a file that only LATER gains a finding (a review finishing while the user
  // sits on this tab) would get its marks but stay collapsed. Re-open on the
  // rising edge only, so a deliberate collapse of an already-flagged file sticks.
  const wasDefaultOpen = React.useRef(defaultOpen);
  React.useEffect(() => {
    if (defaultOpen && !wasDefaultOpen.current) setOpen(true);
    wasDefaultOpen.current = defaultOpen;
  }, [defaultOpen]);

  // Jump to the first flagged line. The file may be collapsed when the badge is
  // clicked, so the scroll waits a frame for the body to mount.
  const jumpToFirstFinding = (e: React.MouseEvent) => {
    e.stopPropagation(); // the header itself toggles; the badge must not close it
    setOpen(true);
    requestAnimationFrame(() =>
      bodyRef.current?.querySelector("[data-flagged]")?.scrollIntoView({ block: "center" })
    );
  };

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;
  const worst = worstSeverity(flags);

  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {worst && (
          <button
            type="button"
            onClick={jumpToFirstFinding}
            style={{ ...s.findingBtn, color: SEV[worst].c }}
            aria-label={t("diffViewer.jumpToFinding", { count: findingCount })}
          >
            {React.createElement(Icon[SEV[worst].icon], { size: 12.5 })}
            <span className="tnum" style={{ fontSize: 12, fontWeight: 600 }}>
              {t("diffViewer.findingCount", { count: findingCount })}
            </span>
          </button>
        )}
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div ref={bodyRef} style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln) => (
              <CodeLine
                // Derived from the parsed line itself (kind + old/new line no.
                // + text) instead of its array index, so the key stays stable
                // if `lines` is ever reordered/filtered independently.
                key={`${ln.kind}-${ln.oldNo ?? ""}-${ln.newNo ?? ""}-${ln.text}`}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                flag={ln.newNo != null ? flags?.get(ln.newNo) : undefined}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
