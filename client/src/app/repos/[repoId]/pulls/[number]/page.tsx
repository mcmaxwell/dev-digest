/* PR Detail — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Basic file-by-file diff viewer in the Files tab
   Tab state lives in query (?tab). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { RepoNotFound } from "@/components/repo-not-found";
import { useSetCrumb } from "@/lib/shell-crumb";
import { PrDetailHeader } from "./_components/PrDetailHeader";
import { OverviewTab } from "./_components/OverviewTab";
import { FindingsTab } from "./_components/FindingsTab";
import { DiffTab } from "./_components/DiffTab";
import type { DiffOrder } from "./_components/OrderToggle/constants";
import RunTraceDrawer from "./_components/RunTraceDrawer";
import { usePullDetailByNumber } from "@/lib/hooks";
import {
  usePrReviews,
  useCancelRun,
  usePrActiveRuns,
  usePrRuns,
  useDeleteRun,
  useInvalidateActiveRuns,
  useInvalidateRunHistory,
} from "@/lib/hooks/reviews";
import { useInvalidateSmartDiff } from "@/lib/hooks/smart-diff";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { githubPrUrl } from "@/lib/github-urls";
import type { FindingRecord } from "@devdigest/shared";

export default function PRDetailPage() {
  const t = useTranslations("prReview");
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number and so is this fetch — the detail endpoint
  // resolves number → row server-side. Going through the PR LIST to find the
  // uuid first made every deep link and refresh a two-request waterfall.
  const {
    data: pr,
    isLoading,
    isError,
    error,
    refetch,
  } = usePullDetailByNumber(repoId, Number(number));
  // The uuid the rest of the PR APIs are keyed by, straight off the detail.
  const prId = pr?.id ?? null;
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun();
  const invalidateActiveRuns = useInvalidateActiveRuns(prId);
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = useInvalidateRunHistory(prId);
  // The Smart Diff's `finding_lines` is server-derived from the latest review,
  // so refetching the reviews alone would leave the Files tab marking the
  // PREVIOUS run's lines for anyone watching a review finish from that tab.
  const invalidateSmartDiff = useInvalidateSmartDiff(prId);
  // Stable identity: RunStatus's effect depends on `onDone` and only re-fires
  // it when `running` flips, but an inline arrow here would get a fresh
  // identity on every render — see RunStatus.tsx for the fallout that causes.
  const handleRunDone = React.useCallback(() => {
    invalidateActiveRuns();
    invalidateRunHistory();
    invalidateSmartDiff();
    refetchReviews();
  }, [invalidateActiveRuns, invalidateRunHistory, invalidateSmartDiff, refetchReviews]);

  const tab = search.get("tab") ?? "overview";
  const traceRunId = search.get("trace");
  // Which finding to reveal on the Findings tab. In the URL (like `tab`/`trace`)
  // so the jump survives a reload and can be shared, and so the Files tab can
  // drive it across a tab switch without lifting the Findings tab's state.
  const focusFindingId = search.get("finding");
  // Also in the URL: the tab unmounts on every switch, so component state would
  // silently drop the reader back to Smart order each time they came back.
  const diffOrder: DiffOrder = search.get("order") === "original" ? "original" : "smart";
  const setParams = (entries: Record<string, string | null>, opts?: { scroll?: boolean }) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, val] of Object.entries(entries)) {
      if (val == null) sp.delete(key);
      else sp.set(key, val);
    }
    router.replace(
      `/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`,
      opts,
    );
  };
  const setParam = (key: string, val: string | null) => setParams({ [key]: val });
  // Clearing `finding` on a plain tab change keeps a stale jump from re-firing
  // every time the user comes back to Findings by hand.
  const setTab = (t: string) => setParams({ tab: t, finding: null });

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = React.useMemo(() => reviews ?? [], [reviews]);
  const allFindings: FindingRecord[] = React.useMemo(
    () => runs.flatMap((r) => r.findings),
    [runs],
  );
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("list.breadcrumb"), href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];
  useSetCrumb(crumb);

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return <RepoNotFound />;
  }

  if (isLoading) {
    return (
      <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
        <Skeleton height={28} width={420} />
        <Skeleton height={16} width={300} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (isError || !pr) {
    return (
      <ErrorState
        fullScreen
        title={t("detail.loadErrorTitle")}
        body={error instanceof ApiError ? error.message : t("detail.loadErrorBody", { number })}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={invalidateActiveRuns}
      />

      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
        {tab === "overview" && <OverviewTab prId={prId} prBody={pr.body} />}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            cancelMutation={cancel}
            focusFindingId={focusFindingId}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm(t("detail.confirmDeleteRun"))) deleteRun.mutate(id);
            }}
            onRunDone={handleRunDone}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            canComment={pr.status === "open"}
            order={diffOrder}
            onOrderChange={(next) => setParam("order", next === "smart" ? null : next)}
            // Clicking a severity mark in the diff crosses to the Findings tab
            // and reveals that exact card — both params move in one navigation.
            // `scroll: false` because the App Router otherwise jumps to the top
            // AFTER the panel has scrolled the card into view, undoing the jump.
            onOpenFinding={(id) =>
              setParams({ tab: "findings", finding: id }, { scroll: false })
            }
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </>
  );
}
