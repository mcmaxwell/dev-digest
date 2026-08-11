"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, EmptyState, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import type { PrBlastResponse } from "@devdigest/shared";
import { usePrBlast, useBlastSummary } from "@/lib/hooks/blast";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { BlastGraph } from "./BlastGraph";
import { BlastStats } from "./BlastStats";
import { BlastTree } from "./BlastTree";
import { IndexNotice } from "./IndexNotice";
import { SummaryBlock } from "./SummaryBlock";
import { ViewToggle } from "./ViewToggle";
import type { BlastView } from "./constants";
import { s } from "./styles";

interface BlastRadiusCardProps {
  prId: string | null;
  repoId: string | null;
  /** `owner/name`, or null before the repo is loaded - the link gate. */
  repoFullName: string | null;
  headSha: string;
}

/**
 * L04 - what else this PR can reach.
 *
 * Sits BESIDE the Intent card on Overview: intent is what the PR meant to do,
 * this is what it can reach, and the two are read together.
 *
 * Five states, split by early return rather than stacked ternaries, because they
 * are five different screens: loading, error, not-analyzed, nothing-indexed, and
 * populated. The heading is rendered by the same `Section` in every one of them,
 * so it never jumps as the data arrives.
 */
export function BlastRadiusCard({
  prId,
  repoId,
  repoFullName,
  headSha,
}: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const tBrief = useTranslations("brief");
  const [view, setView] = React.useState<BlastView>("tree");
  const { data, isLoading, isError, refetch } = usePrBlast(prId);
  const summarize = useBlastSummary(prId);
  const resync = useResyncRepoIntel(repoId);

  if (!prId) return null;

  if (isLoading) {
    return (
      <Section title={tBrief("block.blast")}>
        <Card>
          <Skeleton height={18} width={420} />
        </Card>
      </Section>
    );
  }

  if (isError || !data) {
    return (
      <Section title={tBrief("block.blast")}>
        <Card>
          <ErrorState title={t("errorTitle")} onRetry={() => refetch()} />
        </Card>
      </Section>
    );
  }

  // An unusable index is NOT an empty blast radius. The card says so and offers
  // the one action that fixes it, rather than showing four zeroes.
  if (data.index.status === "degraded") {
    return (
      <Section title={tBrief("block.blast")}>
        <Card>
          <EmptyState
            icon="GitBranch"
            title={t("notIndexedTitle")}
            body={`${t("notIndexedBody")} ${t(`index.${data.index.reason}`)}`}
            cta={resync.isPending ? t("reindexing") : t("reindex")}
            onCta={() => resync.mutate()}
            ctaLoading={resync.isPending}
          />
          {resync.isSuccess && <p style={s.caveat}>{t("reindexQueued")}</p>}
        </Card>
      </Section>
    );
  }

  if (data.blast.changed_symbols.length === 0) {
    return (
      <Section title={tBrief("block.blast")}>
        <Card>
          <IndexNotice index={data.index} />
          <EmptyState
            icon="Code"
            title={t("emptyTitle")}
            body={t("emptyBody", { count: data.changed_files })}
          />
          <p style={s.caveat}>{t("symbolsCaveat")}</p>
        </Card>
      </Section>
    );
  }

  return <BlastBody data={data} view={view} onView={setView} repoFullName={repoFullName} headSha={headSha} summarize={summarize} />;
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
      <SectionLabel icon="GitBranch" right={right}>
        {title}
      </SectionLabel>
      {children}
    </section>
  );
}

function BlastBody({
  data,
  view,
  onView,
  repoFullName,
  headSha,
  summarize,
}: {
  data: PrBlastResponse;
  view: BlastView;
  onView: (next: BlastView) => void;
  repoFullName: string | null;
  headSha: string;
  summarize: ReturnType<typeof useBlastSummary>;
}) {
  const t = useTranslations("blast");
  const tBrief = useTranslations("brief");

  return (
    // The switch lives in the HEADING row rather than beside the counts. The
    // design puts the two together, but that card is ~700px wide and this one is
    // a column of a two-up grid at ~420px: side by side they wrap, leaving the
    // switch stranded on a line of its own. The heading row never wraps.
    <Section title={tBrief("block.blast")} right={<ViewToggle value={view} onChange={onView} />}>
      <Card>
        <IndexNotice index={data.index} />
        <div style={s.headerRow}>
          <BlastStats blast={data.blast} />
        </div>

        {view === "tree" ? (
          <BlastTree
            blast={data.blast}
            repoFullName={repoFullName}
            indexedSha={data.index.last_indexed_sha}
            headSha={headSha}
          />
        ) : (
          <BlastGraph blast={data.blast} />
        )}

        <SummaryBlock
          summary={data.summary}
          pending={summarize.isPending}
          failed={summarize.isError}
          onGenerate={() => summarize.mutate()}
        />

        {/* Both caveats are stated on every populated card. They are the two
            things that make this list honest, and hiding them behind a tooltip
            would be hiding them. The display cap is stated the same way. */}
        <p style={s.caveat}>
          {data.blast.symbols_total > data.blast.changed_symbols.length && (
            <>
              {t("symbolsTruncated", {
                shown: data.blast.changed_symbols.length,
                total: data.blast.symbols_total,
              })}{" "}
            </>
          )}
          {t("symbolsCaveat")} {t("attribution")}
        </p>
      </Card>
    </Section>
  );
}
