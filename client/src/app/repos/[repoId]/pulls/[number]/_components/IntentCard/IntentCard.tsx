"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import { usePrIntent, useDetectIntent } from "@/lib/hooks/intent";
import type { PrIntent } from "@devdigest/shared";
// `RISK_COLOR` / `RISK_ICON` stay in `./constants` even though this file no
// longer reads them: they are the risk-area vocabulary, and deleting them would
// be a second, unrelated change riding along with the rendering move.
import { CONFIDENCE_COLOR } from "./constants";
import { s } from "./styles";

interface IntentCardProps {
  prId: string | null;
}

/**
 * L03 — what this PR says it is for, shown ABOVE the description it was derived
 * from so the reader verifies the machine's reading before trusting a review
 * that was conditioned on it.
 *
 * Split by state with early returns rather than stacked ternaries: loading,
 * error, "not detected yet" and "detected" are four different screens, not four
 * variations of one.
 */
export function IntentCard({ prId }: IntentCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading, isError, refetch } = usePrIntent(prId);
  const detect = useDetectIntent(prId);

  if (!prId) return null;

  if (isLoading) {
    return (
      <Section title={t("block.intent")}>
        <Card>
          <Skeleton height={18} width={420} />
        </Card>
      </Section>
    );
  }

  if (isError) {
    return (
      <Section title={t("block.intent")}>
        <Card>
          <ErrorState title={t("intent.errorTitle")} onRetry={() => refetch()} />
        </Card>
      </Section>
    );
  }

  const intent = data?.intent ?? null;

  if (!intent) {
    return (
      <Section title={t("block.intent")}>
        <Card>
          <EmptyState
            icon="Target"
            title={t("intent.emptyTitle")}
            body={t("intent.emptyBody")}
            cta={detect.isPending ? t("intent.detecting") : t("intent.detect")}
            onCta={() => detect.mutate()}
            ctaLoading={detect.isPending}
          />
        </Card>
      </Section>
    );
  }

  return (
    <IntentBody
      intent={intent}
      detecting={detect.isPending}
      onRedetect={() => detect.mutate()}
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
      <SectionLabel icon="Target" right={right}>
        {title}
      </SectionLabel>
      {children}
    </section>
  );
}

function IntentBody({
  intent,
  detecting,
  onRedetect,
}: {
  intent: PrIntent;
  detecting: boolean;
  onRedetect: () => void;
}) {
  const t = useTranslations("brief");
  // Every source we could not read. Surfacing these is what stops a confident
  // sentence from standing in for context nobody actually had.
  const missing = intent.sources.filter((src) => src.status !== "ok");

  return (
    <Section
      title={t("block.intent")}
      right={
        <div style={s.badgeRow}>
          {intent.stale && (
            <Badge icon="GitCommit" color="var(--sev-warning, #fbbf24)">
              {t("intent.stale")}
            </Badge>
          )}
          <Badge dot color={CONFIDENCE_COLOR[intent.confidence]}>
            {t("intent.confidence", { level: t(`intent.level.${intent.confidence}`) })}
          </Badge>
          <Button kind="ghost" size="sm" icon="RefreshCw" loading={detecting} onClick={onRedetect}>
            {detecting ? t("intent.detecting") : t("intent.redetect")}
          </Button>
        </div>
      }
    >
      <Card>
        <p style={s.summary}>{intent.summary}</p>

        <div style={s.scopeGrid}>
          <ScopeColumn label={t("intent.inScope")} items={intent.in_scope} />
          <ScopeColumn label={t("intent.outOfScope")} items={intent.out_of_scope} />
        </div>

        {/* The risk-area chips used to render here. L05 absorbed them into the
            PR Brief card, whose risks each name a file the reader can click —
            a chip that says "Auth surface touched" and nothing else still leaves
            a reviewer searching nine files for the auth surface. The Overview
            tab now carries exactly one risk list.
            `pr_intent.risk_areas` is still produced, still stored, and still fed
            to the reviewer prompt; only its rendering moved. */}

        {missing.length > 0 && (
          <div style={s.missing}>
            <strong>{t("intent.missingTitle")}</strong>
            <ul style={s.missingList}>
              {missing.map((src) => (
                <li key={`${src.kind}:${src.ref}`}>
                  {t("intent.missingItem", {
                    kind: src.kind,
                    ref: src.ref,
                    status: t(`intent.status.${src.status}`),
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={s.footnote}>
          {t("intent.detectedWith", { provider: intent.provider, model: intent.model })}
        </div>
      </Card>
    </Section>
  );
}

function ScopeColumn({ label, items }: { label: string; items: string[] }) {
  const t = useTranslations("brief");
  return (
    <div>
      <div style={s.columnLabel}>{label}</div>
      {items.length === 0 ? (
        <p style={s.emptyList}>{t("intent.nothingStated")}</p>
      ) : (
        <ul style={s.list}>
          {items.map((item, i) => (
            <li key={`${i}-${item}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
