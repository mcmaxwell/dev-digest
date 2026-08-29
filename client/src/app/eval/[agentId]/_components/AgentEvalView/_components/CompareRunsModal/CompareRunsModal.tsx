/* CompareRunsModal — two runs of one agent, side by side (L06).

   The metric deltas are the headline, but the PAIRED per-case table underneath
   is what makes the comparison readable: on a set of a dozen cases one flipped
   case moves a ratio by more than ten points, so "recall +4pt" cannot be told
   apart from sampling noise, while "these two were lost and this one was
   gained" can. Cases that exist in only one run are shown as such rather than
   dropped — silently comparing two different sets is how a harness starts
   lying. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Modal, Skeleton } from "@devdigest/ui";
import type { EvalCaseDelta, EvalSuiteRunRecord } from "@devdigest/shared";
import { evalF1 } from "@devdigest/shared/contracts/eval-math";
import { useEvalCompare } from "@/lib/hooks/eval";
import { diffPromptLines } from "./helpers";
import { s } from "./styles";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const pts = (d: number) => `${d > 0 ? "▲" : d < 0 ? "▼" : ""}${Math.abs(Math.round(d * 100))}pt`;

/** Green for up, red for down — except cost, where cheaper is better. */
function deltaColor(d: number, lowerIsBetter = false): string {
  if (Math.abs(d) < 0.0005) return "var(--text-muted)";
  const good = lowerIsBetter ? d < 0 : d > 0;
  return good ? "var(--ok)" : "var(--crit)";
}

const CHANGE_COLOR: Record<EvalCaseDelta["change"], string> = {
  gained: "var(--ok)",
  lost: "var(--crit)",
  unchanged: "var(--text-muted)",
  missing_left: "var(--accent)",
  missing_right: "var(--warn)",
};

function MetricDelta({
  label,
  from,
  to,
  lowerIsBetter,
}: {
  label: string;
  from: number;
  to: number;
  lowerIsBetter?: boolean;
}) {
  const d = to - from;
  return (
    <div style={s.delta}>
      <div style={s.deltaLabel}>{label}</div>
      <div style={s.deltaRow}>
        <span style={s.from}>{pct(from)}</span>
        <span style={s.from}>→</span>
        <span style={s.to(deltaColor(d, lowerIsBetter))}>{pct(to)}</span>
        <span style={s.chip(deltaColor(d, lowerIsBetter))}>{pts(d)}</span>
      </div>
    </div>
  );
}

function version(r: EvalSuiteRunRecord): string {
  return `v${r.agent_version ?? 1}`;
}

export function CompareRunsModal({
  left,
  right,
  onClose,
}: {
  left: string;
  right: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalCompare(left, right);

  const promptLines = React.useMemo(
    () =>
      data?.left_prompt != null && data?.right_prompt != null
        ? diffPromptLines(data.left_prompt, data.right_prompt)
        : null,
    [data],
  );

  const moved = (data?.case_deltas ?? []).filter((c) => c.change !== "unchanged").length;

  return (
    <Modal
      width={1020}
      title={
        data
          ? t("compare.title", { left: version(data.left), right: version(data.right) })
          : t("compare.compare")
      }
      subtitle={t("compare.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="secondary" onClick={onClose}>
            {t("compare.close")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : isLoading || !data ? (
          <Skeleton />
        ) : (
          <>
            <div style={s.deltas}>
              <MetricDelta
                label={t("dashboard.metrics.recall")}
                from={data.left.recall}
                to={data.right.recall}
              />
              <MetricDelta
                label={t("dashboard.metrics.precision")}
                from={data.left.precision}
                to={data.right.precision}
              />
              <MetricDelta
                label={t("dashboard.metrics.citationAccuracy")}
                from={data.left.citation_accuracy}
                to={data.right.citation_accuracy}
              />
              <MetricDelta
                label={t("evalsTab.f1")}
                from={evalF1(data.left.precision, data.left.recall)}
                to={evalF1(data.right.precision, data.right.recall)}
              />
            </div>

            <div>
              <div style={s.sectionLabel}>{t("compare.perCase")}</div>
              {/* The honest reading of a small set, stated before the table. */}
              <div style={s.note}>
                {t("compare.noteSmallSet", {
                  total: data.right.traces_total,
                  points: Math.round(100 / Math.max(data.right.traces_total, 1)),
                })}
              </div>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>{t("compare.caseColumn")}</th>
                    <th style={s.th}>
                      {t("compare.leftColumn")} · {version(data.left)}
                    </th>
                    <th style={s.th}>
                      {t("compare.rightColumn")} · {version(data.right)}
                    </th>
                    <th style={s.th}>{t("compare.changeColumn")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.case_deltas.map((c) => (
                    <tr key={c.case_id}>
                      <td style={{ ...s.td, ...s.mono }}>{c.case_name ?? c.case_id}</td>
                      <td style={s.td}>
                        {c.left_pass == null
                          ? "—"
                          : c.left_pass
                            ? t("compare.pass")
                            : t("compare.fail")}
                      </td>
                      <td style={s.td}>
                        {c.right_pass == null
                          ? "—"
                          : c.right_pass
                            ? t("compare.pass")
                            : t("compare.fail")}
                      </td>
                      <td style={{ ...s.td, color: CHANGE_COLOR[c.change], fontWeight: 600 }}>
                        {t(`compare.${c.change}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {moved === 0 && (
                <div style={{ ...s.sectionLabel, marginTop: 10 }}>
                  {t("compare.unchanged")}
                </div>
              )}
            </div>

            <div>
              <div style={s.sectionLabel}>{t("compare.promptDiff")}</div>
              {promptLines == null ? (
                <div style={s.note}>{t("compare.promptMissing")}</div>
              ) : promptLines.every((l) => l.state === "same") ? (
                <div style={s.note}>{t("compare.promptUnchanged")}</div>
              ) : (
                <pre style={s.prompt}>
                  {promptLines.map((l, i) => (
                    <span
                      key={i}
                      style={
                        l.state === "added" ? s.added : l.state === "removed" ? s.removed : undefined
                      }
                    >
                      {l.text || " "}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
