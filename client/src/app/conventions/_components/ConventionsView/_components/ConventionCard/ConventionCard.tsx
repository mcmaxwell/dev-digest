/* ConventionCard — one extracted rule with its grounded evidence, the measured
   adherence, and the accept / reject / edit controls. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, MonoLink, ProgressBar, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { VISIBLE_EVIDENCE } from "../../constants";
import { strengthColor, strengthOf } from "../../helpers";
import { s } from "./styles";

export interface ConventionCardProps {
  candidate: ConventionCandidate;
  /** owner/repo — with an evidence sha it makes `path:line` a GitHub permalink. */
  repoFullName?: string | null;
  busy?: boolean;
  onStatus: (status: ConventionCandidate["status"]) => void;
  onEdit: (rule: string) => void;
}

export function ConventionCard({
  candidate,
  repoFullName,
  busy,
  onStatus,
  onEdit,
}: ConventionCardProps) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(candidate.rule);

  const strength = strengthOf(candidate);
  const shown = candidate.evidence.slice(0, VISIBLE_EVIDENCE);
  const hidden = candidate.evidence.length - shown.length;

  const startEdit = () => {
    setDraft(candidate.rule);
    setEditing(true);
  };

  const save = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== candidate.rule) onEdit(next);
  };

  return (
    <div style={s.card(candidate.status)}>
      <div style={s.main}>
        {editing ? (
          <>
            <Textarea value={draft} onChange={setDraft} rows={3} />
            <div style={s.editRow}>
              <Button kind="ghost" size="sm" onClick={() => setEditing(false)}>
                {t("card.cancel")}
              </Button>
              <Button kind="primary" size="sm" onClick={save} disabled={draft.trim().length < 10}>
                {t("card.save")}
              </Button>
            </div>
          </>
        ) : (
          <div style={s.ruleRow}>
            <div style={s.rule}>{candidate.rule}</div>
            {candidate.edited && <Badge color="var(--text-muted)">{t("card.edited")}</Badge>}
            {candidate.origin === "config" && (
              <Badge color="var(--accent)" bg="var(--accent-bg)">
                {t("card.fromConfig")}
              </Badge>
            )}
          </div>
        )}

        {!editing && candidate.rationale && <div style={s.rationale}>{candidate.rationale}</div>}

        <div style={s.evidence}>
          {shown.map((e) => (
            <div key={`${e.path}:${e.line}`} style={s.evidenceBlock}>
              <div style={s.evidenceHead}>
                <span className="mono" style={s.evidencePath}>
                  {repoFullName && e.sha ? (
                    // Pinned to the verification sha, not a branch, so the line
                    // still points at the evidence after the branch moves.
                    <MonoLink href={githubBlobUrl(repoFullName, e.sha, e.path, e.line)}>
                      {e.path}:{e.line}
                    </MonoLink>
                  ) : (
                    <>
                      {e.path}:{e.line}
                    </>
                  )}
                </span>
                {e.verified === "relocated" && (
                  <span title={t("card.evidenceRelocated")}>
                    <Icon.AlertTriangle size={12} />
                  </span>
                )}
              </div>
              <pre className="mono" style={s.snippet}>
                {e.snippet}
              </pre>
            </div>
          ))}
          {hidden > 0 && <div style={s.moreEvidence}>{t("card.moreEvidence", { count: hidden })}</div>}
        </div>

        <div style={s.metaRow}>
          <span style={s.strengthLabel}>{t("card.confidence")}</span>
          <div style={s.strengthBar}>
            <ProgressBar value={strength * 100} color={strengthColor(strength)} height={5} />
          </div>
          <span className="mono tnum" style={{ ...s.strengthValue, color: strengthColor(strength) }}>
            {Math.round(strength * 100)}%
          </span>
          {candidate.adherence != null ? (
            <span
              style={s.strengthLabel}
              title={t("card.adherenceDetail", {
                support: candidate.support ?? 0,
                violations: candidate.violations ?? 0,
              })}
            >
              {t("card.adherence", { pct: Math.round(candidate.adherence * 100) })}
            </span>
          ) : (
            <span style={s.strengthLabel}>{t("card.unmeasured")}</span>
          )}
        </div>
      </div>

      <div style={s.actions}>
        <Button
          kind={candidate.status === "accepted" ? "primary" : "secondary"}
          size="sm"
          icon="Check"
          disabled={busy}
          onClick={() => onStatus(candidate.status === "accepted" ? "pending" : "accepted")}
        >
          {candidate.status === "accepted" ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          disabled={busy}
          onClick={() => onStatus(candidate.status === "rejected" ? "pending" : "rejected")}
        >
          {candidate.status === "rejected" ? t("card.rejected") : t("card.reject")}
        </Button>
        {!editing && (
          <Button kind="ghost" size="sm" icon="Edit" disabled={busy} onClick={startEdit}>
            {t("card.edit")}
          </Button>
        )}
      </div>
    </div>
  );
}
