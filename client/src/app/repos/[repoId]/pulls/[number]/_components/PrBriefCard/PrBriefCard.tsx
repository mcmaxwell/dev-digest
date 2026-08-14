"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import type {
  BriefHistoryEntry,
  BriefView,
  GroundedRisk,
  PrCommit,
  PrHistoryItem,
  ReviewFocusEntry,
} from "@devdigest/shared";
import { usePrBrief, useGenerateBrief } from "@/lib/hooks/brief";
import { SEVERITY_COLOR, SEVERITY_ICON } from "./constants";
import { s } from "./styles";

interface PrBriefCardProps {
  prId: string | null;
  /**
   * The PR's commits — the spine of the brief-history timeline. In NO
   * particular order: GitHub returns them oldest-first and the server neither
   * reverses nor sorts them, so the timeline establishes its own order.
   */
  commits: PrCommit[];
  /** A URL for the Files changed tab with `path` expanded. Built by the page. */
  fileHref: (path: string) => string;
  /** The client-side jump the anchor performs instead of a full navigation. */
  onOpenFile: (path: string) => void;
}

/**
 * L07 — where to start reading this PR.
 *
 * Sits BELOW the Intent + Blast grid rather than inside it: its review-focus
 * list is a full-width reading order, and the two cards above are the facts it
 * was derived from.
 *
 * Split by state with early returns rather than stacked ternaries, because they
 * are different screens: loading, error, "not generated yet" and "generated" —
 * and `degraded` is a variation of the last one, never an error page.
 */
export function PrBriefCard({ prId, commits, fileHref, onOpenFile }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading, isError, refetch } = usePrBrief(prId);
  const generate = useGenerateBrief(prId);

  if (!prId) return null;

  if (isLoading) {
    return (
      <Section title={t("pr.title")}>
        <Card>
          <Skeleton height={18} width={420} />
        </Card>
      </Section>
    );
  }

  // Offline, or the API is down. An error state with a retry, never a blank
  // card — and distinct from "this PR has no brief", which is a 200.
  if (isError) {
    return (
      <Section title={t("pr.title")}>
        <Card>
          <ErrorState title={t("pr.errorTitle")} onRetry={() => refetch()} />
        </Card>
      </Section>
    );
  }

  const brief = data?.brief ?? null;

  // Generation is always a click. Nothing on this tab generates on render.
  if (!brief) {
    return (
      <Section title={t("pr.title")}>
        <Card>
          <EmptyState
            icon="ListChecks"
            title={t("pr.emptyTitle")}
            body={t("pr.emptyBody")}
            cta={generate.isPending ? t("pr.generating") : t("pr.generate")}
            onCta={() => generate.mutate()}
            ctaLoading={generate.isPending}
          />
          {/* A degraded 200 is a different path, rendered from `pr.degraded.*`
              on the brief itself. This is the transport failure, which would
              otherwise re-render the empty state identically and make the click
              look like it did nothing. Same shape as SummaryBlock's `failed`. */}
          {generate.isError && <p style={s.generateFailed}>{t("pr.generateFailed")}</p>}
        </Card>
      </Section>
    );
  }

  return (
    <BriefBody
      brief={brief}
      commits={commits}
      generating={generate.isPending}
      regenerateFailed={generate.isError}
      onRegenerate={() => generate.mutate()}
      fileHref={fileHref}
      onOpenFile={onOpenFile}
    />
  );
}

/** The card's chrome, shared by every state so the heading never jumps. */
function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <SectionLabel icon="FileText" right={right}>
        {title}
      </SectionLabel>
      {children}
    </section>
  );
}

function BriefBody({
  brief,
  commits,
  generating,
  regenerateFailed,
  onRegenerate,
  fileHref,
  onOpenFile,
}: {
  brief: BriefView;
  commits: PrCommit[];
  generating: boolean;
  regenerateFailed: boolean;
  onRegenerate: () => void;
  fileHref: (path: string) => string;
  onOpenFile: (path: string) => void;
}) {
  const t = useTranslations("brief");
  const droppedTotal =
    brief.dropped.risks +
    brief.dropped.focus +
    brief.dropped.file_refs +
    brief.dropped.lines +
    brief.dropped.endpoints +
    brief.dropped.crons;
  const prose = [brief.prose.what, brief.prose.why].filter(Boolean).join(" ");

  return (
    <Section
      title={t("pr.title")}
      right={
        <div style={s.badgeRow}>
          {/* Staleness is derived on read against BOTH the PR head and the
              indexed commit, so a brief can rot without the PR moving at all.
              The badge sits above the FULL contents, never instead of them. */}
          {brief.meta.stale && (
            <Badge icon="GitCommit" color="var(--sev-warning, #fbbf24)">
              {t("pr.stale")}
            </Badge>
          )}
          <Badge
            icon={SEVERITY_ICON[brief.risk_level]}
            color={SEVERITY_COLOR[brief.risk_level]}
          >
            {t("pr.riskLevel", { level: t(`pr.level.${brief.risk_level}`) })}
          </Badge>
          <Button
            kind="ghost"
            size="sm"
            icon="Sparkles"
            loading={generating}
            onClick={onRegenerate}
          >
            {generating ? t("pr.generating") : t("pr.regenerate")}
          </Button>
          {regenerateFailed && <span style={s.generateFailed}>{t("pr.generateFailed")}</span>}
        </div>
      }
    >
      <Card>
        {brief.status === "degraded" && brief.degraded_reason && (
          <div style={s.notice}>
            <strong style={s.noticeTitle}>{t("pr.degradedTitle")}</strong>{" "}
            {t(`pr.degraded.${brief.degraded_reason}`)}
            <div style={s.noticeActions}>
              <Button
                kind="ghost"
                size="sm"
                icon="RefreshCw"
                loading={generating}
                onClick={onRegenerate}
              >
                {generating ? t("pr.generating") : t("pr.retry")}
              </Button>
            </div>
          </div>
        )}

        {brief.meta.stale && <p style={s.emptyLine}>{t("pr.staleHint")}</p>}

        {prose.length > 0 && <p style={s.prose}>{prose}</p>}

        <RiskList risks={brief.risks} fileHref={fileHref} onOpenFile={onOpenFile} />

        <FocusList
          entries={brief.review_focus}
          fileHref={fileHref}
          onOpenFile={onOpenFile}
        />

        <PriorPulls history={brief.history} />

        <BriefHistory commits={commits} entries={brief.brief_history} />

        {/* Without this a brief that dropped nine of ten statements looks the
            same as one that dropped none, and the reader cannot calibrate. */}
        {droppedTotal > 0 && (
          <p style={s.footnote}>
            <strong style={s.noticeTitle}>{t("pr.droppedTitle")}</strong>{" "}
            {t("pr.dropped", { count: droppedTotal })}
          </p>
        )}

        {brief.meta.provider.length > 0 && (
          <p style={s.footnote}>
            {t("pr.by", { provider: brief.meta.provider, model: brief.meta.model })}
          </p>
        )}
      </Card>
    </Section>
  );
}

function RiskList({
  risks,
  fileHref,
  onOpenFile,
}: {
  risks: GroundedRisk[];
  fileHref: (path: string) => string;
  onOpenFile: (path: string) => void;
}) {
  const t = useTranslations("brief");
  return (
    <div style={s.block}>
      <div style={s.columnLabel}>
        <Icon.Shield size={12} aria-hidden />
        {t("block.risks")}
      </div>
      {risks.length === 0 ? (
        <p style={s.emptyLine}>{t("noRisks")}</p>
      ) : (
        <ul style={s.list} aria-label={t("block.risks")}>
          {risks.map((risk, i) => {
            const SevIcon = Icon[SEVERITY_ICON[risk.severity]];
            return (
              <li key={`${risk.kind}-${risk.title}-${i}`} style={s.riskRow}>
                <div style={s.riskHead}>
                  {/* Severity is icon + written level as well as colour: a
                      colour-blind reviewer must still be able to rank these. */}
                  <SevIcon size={13} style={{ color: SEVERITY_COLOR[risk.severity], flexShrink: 0 }} />
                  <span style={s.riskTitle} title={risk.title}>
                    {risk.title}
                  </span>
                  <Badge color={SEVERITY_COLOR[risk.severity]}>
                    {t(`pr.severity.${risk.severity}`)}
                  </Badge>
                </div>
                <p style={s.riskBody}>{risk.explanation}</p>
                <div style={s.refRow}>
                  {risk.file_refs.map((path) => (
                    <FileLink
                      key={path}
                      path={path}
                      line={null}
                      fileHref={fileHref}
                      onOpenFile={onOpenFile}
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FocusList({
  entries,
  fileHref,
  onOpenFile,
}: {
  entries: ReviewFocusEntry[];
  fileHref: (path: string) => string;
  onOpenFile: (path: string) => void;
}) {
  const t = useTranslations("brief");
  return (
    <div style={s.block}>
      <div style={s.columnLabel}>
        <Icon.ListChecks size={12} aria-hidden />
        {t("pr.focusTitle")}
      </div>
      {entries.length === 0 ? (
        <p style={s.emptyLine}>{t("pr.noFocus")}</p>
      ) : (
        // Rendered in STORED ORDER. That array is the ranking the model
        // produced, and re-sorting it here would silently discard it.
        <ul style={s.list} aria-label={t("pr.focusTitle")}>
          {entries.map((entry, i) => (
            <li key={`${entry.file}-${entry.line ?? "none"}-${i}`} style={s.focusRow}>
              <span aria-hidden style={s.marker}>
                ▸
              </span>
              <FileLink
                path={entry.file}
                line={entry.line}
                fileHref={fileHref}
                onOpenFile={onOpenFile}
              />
              <span style={s.focusReason}>— {entry.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One file reference.
 *
 * A real `<a href>`, not a button: it is announced as a link, it is reachable
 * by Tab and activated by Enter with no key handler of our own, and its
 * accessible name is the path. The click is intercepted so the jump is a
 * client-side param change rather than a navigation — the same cross-tab move
 * the diff's severity marks already make into the Findings tab.
 */
function FileLink({
  path,
  line,
  fileHref,
  onOpenFile,
}: {
  path: string;
  line: number | null;
  fileHref: (path: string) => string;
  onOpenFile: (path: string) => void;
}) {
  const t = useTranslations("brief");
  return (
    <a
      href={fileHref(path)}
      style={s.fileLink}
      title={line == null ? path : `${path}:${line}`}
      aria-label={
        line == null
          ? t("pr.openFile", { file: path })
          : t("pr.openFileLine", { file: path, line })
      }
      onClick={(e) => {
        // Leave modified clicks alone: a middle-click or ⌘-click on a real link
        // should still open a tab, which is half the point of using an anchor.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onOpenFile(path);
      }}
    >
      {line == null ? path : `${path}:${line}`}
    </a>
  );
}

function PriorPulls({ history }: { history: PrHistoryItem[] }) {
  const t = useTranslations("brief");
  return (
    <div style={s.block}>
      <div style={s.columnLabel}>
        <Icon.History size={12} aria-hidden />
        {t("block.history")}
      </div>
      {history.length === 0 ? (
        <p style={s.emptyLine}>{t("noHistory")}</p>
      ) : (
        <ul style={s.list} aria-label={t("block.history")}>
          {history.map((item) => (
            <li key={item.pr_number} style={s.focusRow}>
              <span className="mono" style={s.sha}>
                #{item.pr_number}
              </span>
              <span style={s.focusReason}>{item.title}</span>
              <Badge>{t("overlap", { count: item.files_overlap.length })}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The PR's commits, newest first (AC-45).
 *
 * The `commits` prop carries no usable order: `pulls.listCommits` returns
 * oldest-first and neither `adapters/github/octokit.ts` nor
 * `pulls/repository.ts#getCommits` reverses or sorts it, so rendering the prop
 * order puts the oldest reading at the top.
 *
 * `committed_at` is the key when GitHub supplied one for EVERY commit. It is
 * nullish in the contract (the mock platform returns null for all of them), and
 * a per-row fallback would sort the timestamped rows into one block and the rest
 * into another — so the decision is taken once for the whole list, and the
 * fallback reverses the incoming oldest-first order instead. Either way a commit
 * with no brief keeps its place in the one sequence (AC-46).
 */
function commitsNewestFirst(commits: PrCommit[]): PrCommit[] {
  const ordered = [...commits];
  return commits.every((c) => !!c.committed_at)
    ? ordered.sort((a, b) => Date.parse(b.committed_at!) - Date.parse(a.committed_at!))
    : ordered.reverse();
}

/**
 * This PR's own timeline: how the brief read at each commit that had one.
 *
 * The COMMITS are the spine, not the entries — a commit with no brief renders
 * with an explicit marker rather than being omitted, because "no brief was
 * written here" is the fact a reader is looking for when a PR's purpose drifted.
 * Entries whose commit is no longer in the PR (a force-push, a rebase) are
 * appended after, so a generation is never silently lost.
 *
 * Rendered whenever there is at least one entry, including exactly one.
 */
function BriefHistory({
  commits,
  entries,
}: {
  commits: PrCommit[];
  entries: BriefHistoryEntry[];
}) {
  const t = useTranslations("brief");
  const [open, setOpen] = React.useState(false);
  if (entries.length === 0) return null;

  const byCommit = new Map(entries.map((e) => [e.head_sha, e]));
  const seen = new Set<string>();
  const rows = commitsNewestFirst(commits).map((commit) => {
    const entry = byCommit.get(commit.sha) ?? null;
    if (entry) seen.add(commit.sha);
    return { sha: commit.sha, entry };
  });
  for (const entry of entries) {
    if (!seen.has(entry.head_sha)) rows.push({ sha: entry.head_sha, entry });
  }

  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <div style={s.block}>
      <button
        type="button"
        style={s.historyToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Chevron size={12} aria-hidden />
        {t("pr.historyTitle")}
        <span style={{ opacity: 0.8 }}>· {t("pr.historyToggle", { count: entries.length })}</span>
      </button>
      {open && (
        <ul style={s.timeline} aria-label={t("pr.historyTitle")}>
          {rows.map(({ sha, entry }) => (
            <li key={sha} style={s.timelineRow}>
              <span className="mono" style={s.sha}>
                {sha.slice(0, 7)}
              </span>
              {entry ? (
                <>
                  <Badge color={SEVERITY_COLOR[entry.risk_level]}>
                    {t("pr.historyEntry", { level: t(`pr.level.${entry.risk_level}`) })}
                  </Badge>
                  <span style={s.timelineWhat}>{entry.what}</span>
                </>
              ) : (
                <span style={s.emptyLine}>{t("pr.historyNone")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
