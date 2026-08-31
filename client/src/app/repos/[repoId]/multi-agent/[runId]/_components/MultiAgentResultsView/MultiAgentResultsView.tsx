/* MultiAgentResultsView - every agent's answer to one pull request, side by
   side, and the places where they disagreed.

   Three rejected mockup lines shape this file:
   - the header says "parallel", not "fan-out via worktrees". Every agent read
     the SAME diff; nothing was checked out per agent.
   - a "did not flag" cell carries no explanatory sentence. An agent that did
     not flag something wrote nothing about it, and inventing a reason would
     take a second model pass over the other agents' findings.
   - the disagreement table's columns are exactly the agents IN THIS RUN, all of
     them, in every row - never an agent that was not selected. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, CircularScore, Toggle } from "@devdigest/ui";
import type { AgentColumn, Conflict, ConflictTake, FindingRecord } from "@devdigest/shared";
import { useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useFindingAction } from "@/lib/hooks/reviews";
import { usePullDetail } from "@/lib/hooks";
import { FindingCard } from "@/components/finding-card";
import { EvalCaseModal } from "@/components/eval-case-modal";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { evalCaseFromFinding } from "@/lib/eval-case";
import { formatUsd } from "@/lib/format";
import {
  COLUMN_GAP,
  COLUMN_MIN_WIDTH,
  SEV_COLOR,
  agentColor,
  type ViewMode,
} from "./constants";
import { isFailed, onlyConflicts, readViewMode, sortFindings, writeViewMode } from "./helpers";
import { s } from "./styles";

export function MultiAgentResultsView({ repoId, runId }: { repoId: string; runId: string }) {
  const t = useTranslations("runs");
  const router = useRouter();
  const { data: run, isLoading, isError, refetch } = useMultiAgentRun(runId);

  // The remembered choice is read AFTER mount: `localStorage` does not exist
  // during the server render, and reading it in the initial state would make
  // the first client paint disagree with the server's HTML.
  const [view, setView] = React.useState<ViewMode>("columns");
  React.useEffect(() => setView(readViewMode()), []);
  const chooseView = (mode: ViewMode) => {
    setView(mode);
    writeViewMode(mode);
  };

  // The columns view falls back to tabs when the agents cannot each get a
  // readable column in the space actually available. It overrides the
  // preference without overwriting it, so a wider window - or a smaller run -
  // gets the remembered choice back.
  const columnsFit = useColumnsFit(run?.columns.length ?? 0);
  const effectiveView: ViewMode = view === "columns" && columnsFit.fits ? "columns" : "tabs";

  const [traceFor, setTraceFor] = React.useState<AgentColumn | null>(null);

  if (isLoading) return <div style={s.note}>{t("results.loading")}</div>;
  if (isError || !run) {
    return (
      <div style={s.wrap}>
        <div style={s.note}>{t("results.loadError")}</div>
        <Button kind="secondary" size="sm" onClick={() => refetch()}>
          {t("results.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <Button
          kind="secondary"
          size="sm"
          icon="Settings"
          onClick={() => router.push(`/repos/${repoId}/multi-agent/new`)}
        >
          {t("results.configure")}
        </Button>
        <h1 style={s.title}>{t("page.title")}</h1>
        {/* AC-32: how many agents, that they ran in PARALLEL, the duration and
            the cost - with the partial marker when a cost is unknown. */}
        <span style={s.meta}>
          {t("page.meta", {
            count: run.agent_count,
            duration: `${(run.total_duration_ms / 1000).toFixed(1)}s`,
            cost: run.total_cost_partial
              ? t("page.metaPartial", { cost: formatUsd(run.total_cost_usd) })
              : formatUsd(run.total_cost_usd),
          })}
        </span>
        <div style={s.headerRight}>
          <Button
            kind={effectiveView === "columns" ? "primary" : "secondary"}
            size="sm"
            onClick={() => chooseView("columns")}
          >
            {t("results.view.columns")}
          </Button>
          <Button
            kind={effectiveView === "tabs" ? "primary" : "secondary"}
            size="sm"
            onClick={() => chooseView("tabs")}
          >
            {t("results.view.tabs")}
          </Button>
        </div>
      </div>

      <div style={s.prLine}>
        <span className="mono">
          {run.pr_number != null
            ? t("results.pr", { number: run.pr_number, title: run.pr_title ?? "" })
            : t("results.noPr")}
        </span>
      </div>

      {/* Measured here rather than on the page: the viewport says nothing about
          the width left over after the app shell's sidebar. */}
      <div ref={columnsFit.ref}>
        {effectiveView === "columns" ? (
          <ColumnsView columns={run.columns} onOpenTrace={setTraceFor} />
        ) : (
          <TabsView columns={run.columns} prId={run.pr_id} onOpenTrace={setTraceFor} />
        )}
      </div>

      <DisagreementSection conflicts={run.conflicts} />

      {traceFor && (
        <RunTraceDrawer
          runId={traceFor.run_id}
          agentName={traceFor.agent_name}
          prNumber={run.pr_number ?? null}
          findings={traceFor.findings}
          running={traceFor.status === "running"}
          onClose={() => setTraceFor(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Whether every agent column fits at `COLUMN_MIN_WIDTH` in the space actually
 * available, measured on the element that holds the view.
 *
 * A viewport breakpoint alone is not enough: five agents overflowed a 1600px
 * window (scrollWidth 1548 against clientWidth 1278) because the sidebar, the
 * page padding and the agent COUNT all decide the answer together.
 *
 * An unmeasured width (the server render, and the first client paint before the
 * effect runs) counts as fitting, so the two renders agree and the fallback is
 * only ever an upgrade to what was measured.
 */
function useColumnsFit(agentCount: number): {
  ref: (node: HTMLDivElement | null) => void;
  fits: boolean;
} {
  // A callback ref, not `useRef`: the element only mounts once the run has
  // loaded, and a `[]` effect would have measured a null ref before that.
  const [node, setNode] = React.useState<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  const needed = agentCount * COLUMN_MIN_WIDTH + Math.max(agentCount - 1, 0) * COLUMN_GAP;
  return { ref: setNode, fits: width === 0 || needed <= width };
}

function ColumnsView({
  columns,
  onOpenTrace,
}: {
  columns: AgentColumn[];
  onOpenTrace: (c: AgentColumn) => void;
}) {
  const t = useTranslations("runs");
  return (
    <div style={s.columns}>
      {columns.map((c, i) => (
        <div key={c.run_id} style={s.column}>
          {/* The agent's colour, by its index in the run's stable order. */}
          <div data-testid="agent-accent" style={s.columnAccent(agentColor(i))} />
          <div style={s.columnHead}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={s.columnName}>{c.agent_name}</div>
              <div style={s.columnStat}>
                {c.duration_ms != null ? `${(c.duration_ms / 1000).toFixed(1)}s` : "n/a"} ·{" "}
                {formatUsd(c.cost_usd)} ·{" "}
                {/* The score is the run's own, derived from its findings. */}
                {c.score != null ? t("column.score", { score: c.score }) : t("column.noScore")}
              </div>
            </div>
            <ScoreRing score={c.score} size={34} />
            <ColumnStatusBadge column={c} />
          </div>

          <div style={s.columnBody}>
            <ColumnBody column={c} />
          </div>

          <div style={s.columnFoot}>
            <button
              type="button"
              onClick={() => onOpenTrace(c)}
              aria-label={t("column.openTrace", { agent: c.agent_name })}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--accent)",
                fontSize: 12,
              }}
            >
              {t("column.viewTrace")}
            </button>
            <span style={{ marginLeft: "auto" }}>
              {t("column.findingsCount", { count: c.findings.length })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The same ring the pull request page draws for the same number
 * (`VerdictBanner`), so one score does not look like two different facts.
 *
 * `aria-hidden` because the value is already printed as text beside it - the
 * ring is the glanceable copy, not the accessible one - and an agent with no
 * score simply has no ring.
 */
function ScoreRing({ score, size }: { score: number | null; size: number }) {
  if (score == null) return null;
  return (
    <span data-testid="score-ring" aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0 }}>
      <CircularScore score={score} size={size} stroke={4} />
    </span>
  );
}

/** A run's state as TEXT, so it is readable without colour. */
function ColumnStatusBadge({ column }: { column: AgentColumn }) {
  const t = useTranslations("runs");
  if (column.status === "running") {
    return <Badge color="var(--accent)" dot>{t("runsTab.status.running")}</Badge>;
  }
  if (isFailed(column)) {
    return (
      <Badge color="var(--sev-critical, #ef4444)" dot>
        {t(`runsTab.status.${column.status ?? "failed"}` as "runsTab.status.failed")}
      </Badge>
    );
  }
  return null;
}

/** AC-39 / AC-40: a failed agent shows its error; a running one shows running. */
function ColumnBody({ column }: { column: AgentColumn }) {
  const t = useTranslations("runs");

  if (isFailed(column)) {
    return (
      <>
        <div style={s.columnNote}>{t("column.failed")}</div>
        {column.error && <div style={s.columnError}>{column.error}</div>}
      </>
    );
  }
  if (column.status === "running") {
    // NOT "no findings": an agent still working has not decided anything yet.
    return <div style={s.columnNote}>{t("column.running")}</div>;
  }
  if (column.findings.length === 0) {
    return <div style={s.columnNote}>{t("column.noFindings")}</div>;
  }
  return (
    <>
      {sortFindings(column.findings).map((f) => (
        <div key={f.id} style={s.findingRow(SEV_COLOR[f.severity])}>
          {/* Severity as TEXT, not only as a colour bar. */}
          <div style={s.findingWhere}>{f.severity}</div>
          <div style={s.findingTitle} title={f.title}>
            {f.title}
          </div>
          <div style={s.findingWhere}>{`${f.file}:${f.start_line}`}</div>
        </div>
      ))}
    </>
  );
}

function TabsView({
  columns,
  prId,
  onOpenTrace,
}: {
  columns: AgentColumn[];
  prId: string;
  onOpenTrace: (c: AgentColumn) => void;
}) {
  const t = useTranslations("runs");
  const [activeId, setActiveId] = React.useState(columns[0]?.run_id ?? "");
  const activeIndex = Math.max(
    columns.findIndex((c) => c.run_id === activeId),
    0,
  );
  const active = columns[activeIndex];

  if (!active) return null;

  return (
    <div>
      <div style={s.tabStrip} role="tablist">
        {columns.map((c, i) => (
          <button
            key={c.run_id}
            type="button"
            role="tab"
            aria-selected={c.run_id === active.run_id}
            style={s.tab(c.run_id === active.run_id, agentColor(i))}
            onClick={() => setActiveId(c.run_id)}
          >
            {c.agent_name}{" "}
            <span className="mono" style={{ color: "var(--text-muted)" }}>
              {c.score != null ? c.score : t("column.noScore")}
            </span>
          </button>
        ))}
      </div>

      <div style={s.verdictBar(agentColor(activeIndex))}>
        <ScoreRing score={active.score} size={44} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={s.columnName}>{active.agent_name}</div>
          {/* AC-35: the agent's persisted review summary, verbatim. */}
          <Summary key={active.run_id} text={active.summary} />
        </div>
        <div style={s.columnStat}>
          {active.duration_ms != null ? `${(active.duration_ms / 1000).toFixed(1)}s` : "n/a"} ·{" "}
          {formatUsd(active.cost_usd)} ·{" "}
          {active.score != null ? t("column.score", { score: active.score }) : t("column.noScore")}
        </div>
        <button
          type="button"
          onClick={() => onOpenTrace(active)}
          aria-label={t("column.openTrace", { agent: active.agent_name })}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--accent)",
            fontSize: 12,
          }}
        >
          {t("column.viewTrace")}
        </button>
      </div>

      <AgentFindings key={active.run_id} column={active} prId={prId} />
    </div>
  );
}

/**
 * The agent's persisted summary, clamped to two lines with an expand control.
 *
 * The mockup assumed a one-line verdict and a real `Review.summary` is a
 * paragraph, so the card became a wall of text. The clamp is CSS: the whole
 * string is in the DOM in both states, because AC-35 requires the persisted
 * summary VERBATIM - nothing is cut in JavaScript, summarised or re-generated.
 *
 * The control appears only when the text actually overflows two lines, measured
 * after paint - a one-line summary with a "Show more" button under it would be
 * its own defect.
 */
function Summary({ text }: { text: string | null }) {
  const t = useTranslations("runs");
  const [expanded, setExpanded] = React.useState(false);
  const [overflows, setOverflows] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <>
      <div ref={ref} style={s.summary(!expanded)}>
        {text ?? t("tabs.noSummary")}
      </div>
      {overflows && (
        <button type="button" style={s.summaryToggle} onClick={() => setExpanded((x) => !x)}>
          {expanded ? t("tabs.showLess") : t("tabs.showMore")}
        </button>
      )}
    </>
  );
}

/**
 * One agent's findings as full cards - the SAME card the pull request page
 * mounts, so Accept and Dismiss write the same records and a finding acted on
 * here shows as acted on there.
 */
function AgentFindings({ column, prId }: { column: AgentColumn; prId: string }) {
  const t = useTranslations("runs");
  const action = useFindingAction();
  // Already in the cache when the user arrived from the pull request; a read,
  // not a second round trip. Needed for the patch a minted eval case is cut from.
  const { data: pull } = usePullDetail(prId);
  const [minting, setMinting] = React.useState<ReturnType<typeof evalCaseFromFinding>>(null);

  if (isFailed(column)) {
    return (
      <div style={s.empty}>
        {t("column.failed")}
        {column.error ? ` ${column.error}` : ""}
      </div>
    );
  }
  if (column.status === "running") return <div style={s.empty}>{t("column.running")}</div>;
  if (column.findings.length === 0) return <div style={s.empty}>{t("column.noFindings")}</div>;

  return (
    <div style={s.cards}>
      {sortFindings(column.findings).map((f: FindingRecord, i) => (
        <FindingCard
          key={f.id}
          f={f}
          defaultExpanded={i === 0}
          pending={action.isPending}
          onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
          onCreateEvalCase={() =>
            setMinting(
              evalCaseFromFinding(f, pull?.files.find((file) => file.path === f.file)?.patch),
            )
          }
        />
      ))}

      {minting && (
        <EvalCaseModal
          agentId={column.agent_id}
          evalCase={null}
          initial={minting}
          onClose={() => setMinting(null)}
        />
      )}
    </div>
  );
}

function DisagreementSection({ conflicts }: { conflicts: Conflict[] }) {
  const t = useTranslations("runs");
  const [conflictsOnly, setConflictsOnly] = React.useState(false);
  const shown = conflictsOnly ? onlyConflicts(conflicts) : conflicts;

  return (
    <section style={s.section}>
      <div style={s.sectionHead}>
        <span style={s.sectionTitle}>{t("conflicts.title")}</span>
        <div style={s.toggleGroup}>
          {t("conflicts.onlyConflicts")}
          <Toggle on={conflictsOnly} onChange={setConflictsOnly} size={16} />
        </div>
      </div>

      {shown.length === 0 ? (
        // AC-52: state that they agreed rather than render an empty table.
        <div style={s.empty}>
          {conflictsOnly && conflicts.length > 0
            ? t("conflicts.emptyFiltered")
            : t("conflicts.empty")}
        </div>
      ) : (
        shown.map((c) => (
          <div key={`${c.file}:${c.line}:${c.title}`} style={s.cluster}>
            <div style={s.clusterHead}>
              {/* AC-44: the file and the START LINE of the titling finding. */}
              <span style={s.clusterWhere}>{`${c.file}:${c.line}`}</span>
              <span style={s.clusterTitle} title={c.title}>
                {c.title}
              </span>
            </div>
            <div style={s.takes}>
              {c.takes.map((take) => (
                <TakeCell key={take.agent_id} take={take} />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

/** One agent's stance on one cluster. Every state is carried by TEXT. */
function TakeCell({ take }: { take: ConflictTake }) {
  const t = useTranslations("runs");
  const flagged = take.verdict !== "did_not_flag" && take.verdict !== "no_opinion";

  return (
    <div style={s.take}>
      {/* On a narrow viewport the cells stack, and this is the row's label. */}
      <div style={s.takeAgent}>{take.persona}</div>
      {flagged ? (
        <>
          <span style={s.takeVerdict(SEV_COLOR[take.verdict as keyof typeof SEV_COLOR])}>
            {take.verdict}
          </span>
          {/* That finding's OWN rationale, truncated to one line - never a
              sentence about it invented after the fact. */}
          {take.note && <div style={s.takeNote}>{take.note}</div>}
        </>
      ) : (
        // "did not flag" and "no opinion" are DIFFERENT facts: one agent ran and
        // said nothing, the other never got to look.
        <span style={s.takeSilent}>
          {take.verdict === "did_not_flag"
            ? t("conflicts.didNotFlag")
            : t("conflicts.noOpinion")}
        </span>
      )}
    </div>
  );
}
