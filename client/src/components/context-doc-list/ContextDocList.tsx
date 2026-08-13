/* ContextDocList — the body of a Context tab, shared by the agent editor and
   the skill editor.

   The owner's attachment set is a single ORDERED array of `(repo_id, path)`
   pairs; every edit here produces a new full array and hands it to `onChange`,
   which is exactly the shape both PUT endpoints take. Rows attached to a
   repository other than the active one are grouped and marked, never dropped:
   they are still part of the set, they just do not apply to this repository. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon } from "@devdigest/ui";
import type { ContextAttachment, ProjectDoc } from "@/lib/types";
import { ContextDocRow } from "./ContextDocRow";
import { AvailableDocList } from "./AvailableDocList";
import { TOKEN_BUDGET, TOKEN_WARN_AT } from "./constants";
import { s } from "./styles";

export interface ContextDocListProps {
  /** Documents of the ACTIVE repository — the M in "N of M attached". */
  available: ProjectDoc[];
  /** The owner's own attachments, in stored order, across every repository. */
  attached: ContextAttachment[];
  /** Agent-only: documents from enabled linked skills. No reorder, no detach. */
  inherited?: ContextAttachment[];
  activeRepoId: string | null;
  /** Whether the attached group offers reorder controls (agents order, skills do not). */
  orderable?: boolean;
  hint: string;
  /** Href of the Project Context page, for the zero-document empty state. */
  contextHref: string | null;
  onChange: (docs: { repo_id: string; path: string }[]) => void;
}

const toWire = (rows: ContextAttachment[]) =>
  rows.map((r) => ({ repo_id: r.repo_id, path: r.path }));

export function ContextDocList({
  available,
  attached,
  inherited = [],
  activeRepoId,
  orderable,
  hint,
  contextHref,
  onChange,
}: ContextDocListProps) {
  const t = useTranslations("context");
  const [filter, setFilter] = React.useState("");
  const q = filter.trim().toLowerCase();

  const attachedHere = attached.filter((a) => a.repo_id === activeRepoId);
  const attachedElsewhere = attached.filter((a) => a.repo_id !== activeRepoId);
  const attachedPaths = new Set(attachedHere.map((a) => a.path));

  const matches = (path: string) => !q || path.toLowerCase().includes(q);
  const visibleAttached = attachedHere.filter((a) => matches(a.path));
  const visibleAvailable = available.filter((d) => !attachedPaths.has(d.path) && matches(d.path));

  const tokensTotal =
    attachedHere.reduce((sum, a) => sum + a.tokens, 0) +
    inherited.reduce((sum, a) => sum + a.tokens, 0);
  const overWarn = tokensTotal > TOKEN_WARN_AT;

  /** Swap two positions of the FULL attached array and persist the result. */
  const swap = (a: ContextAttachment, b: ContextAttachment) => {
    const next = [...attached];
    const i = next.indexOf(a);
    const j = next.indexOf(b);
    if (i < 0 || j < 0) return;
    next[i] = b;
    next[j] = a;
    onChange(toWire(next));
  };

  const detach = (row: ContextAttachment) =>
    onChange(toWire(attached.filter((a) => !(a.repo_id === row.repo_id && a.path === row.path))));

  const attach = (path: string) => {
    if (!activeRepoId) return;
    onChange([...toWire(attached), { repo_id: activeRepoId, path }]);
  };

  // Nothing to attach at all — point at the page that would fill the list.
  if (available.length === 0 && attached.length === 0 && inherited.length === 0) {
    return (
      <div style={s.wrap}>
        <div style={s.header}>
          <h2 style={s.h2}>{t("tab.title")}</h2>
          <Badge color="var(--text-muted)">{t("tab.emptyTitle")}</Badge>
        </div>
        <p style={s.hint}>
          {activeRepoId ? t("tab.emptyBody") : t("tab.noRepo")}
        </p>
        {contextHref && (
          <a href={contextHref} style={{ fontSize: 13, color: "var(--accent-text)" }}>
            {t("tab.emptyLink")}
          </a>
        )}
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("tab.title")}</h2>
        <Badge color="var(--accent)" bg="var(--accent-bg)">
          {t("tab.attachedCount", { attached: attachedHere.length, available: available.length })}
        </Badge>
        <div style={s.filter}>
          <Icon.Search size={13} style={s.filterIcon} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("tab.filterPlaceholder")}
            aria-label={t("tab.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>
      <p style={s.hint}>{hint}</p>

      {visibleAttached.length > 0 && (
        <>
          <div style={s.groupLabel}>{t("tab.attached")}</div>
          <div style={s.list}>
            {visibleAttached.map((row, i) => (
              <ContextDocRow
                key={`${row.repo_id}:${row.path}`}
                path={row.path}
                tokens={row.tokens}
                missing={row.status === "missing"}
                attached
                onToggle={() => detach(row)}
                reorderable={orderable}
                {...(orderable && i > 0
                  ? { onMoveUp: () => swap(row, visibleAttached[i - 1]!) }
                  : {})}
                {...(orderable && i < visibleAttached.length - 1
                  ? { onMoveDown: () => swap(row, visibleAttached[i + 1]!) }
                  : {})}
              />
            ))}
          </div>
        </>
      )}

      {inherited.length > 0 && (
        <>
          <div style={s.groupLabel}>{t("tab.inherited")}</div>
          <p style={s.hint}>{t("tab.inheritedHint")}</p>
          <div style={s.list}>
            {inherited.map((row) => (
              <ContextDocRow
                key={`skill:${row.skill_name}:${row.repo_id}:${row.path}`}
                path={row.path}
                tokens={row.tokens}
                missing={row.status === "missing"}
                attached
                viaSkill={row.skill_name}
                notUsedHere={row.repo_id !== activeRepoId}
              />
            ))}
          </div>
        </>
      )}

      {attachedElsewhere.length > 0 && (
        <OtherRepoGroups rows={attachedElsewhere} onDetach={detach} />
      )}

      <div style={s.groupLabel}>{t("tab.available")}</div>
      {visibleAttached.length === 0 && visibleAvailable.length === 0 ? (
        <div style={s.noMatch}>
          <span>{q ? t("tab.noMatch", { filter }) : t("tab.emptyBody")}</span>
          {q && (
            <Button kind="ghost" onClick={() => setFilter("")}>
              {t("tab.clearFilter")}
            </Button>
          )}
        </div>
      ) : (
        <AvailableDocList docs={visibleAvailable} onAttach={attach} />
      )}

      <div style={s.footer}>
        <span style={overWarn ? s.footerWarn : s.footerOk}>
          {overWarn
            ? t("tab.tokensWarning", {
                tokens: tokensTotal,
                warn: TOKEN_WARN_AT,
                budget: TOKEN_BUDGET,
              })
            : t("tab.tokens", { tokens: tokensTotal })}
        </span>
      </div>
    </div>
  );
}

/** Attachments belonging to other repositories, grouped under each repo's name. */
function OtherRepoGroups({
  rows,
  onDetach,
}: {
  rows: ContextAttachment[];
  onDetach: (row: ContextAttachment) => void;
}) {
  const t = useTranslations("context");
  const byRepo = new Map<string, ContextAttachment[]>();
  for (const row of rows) {
    byRepo.set(row.repo_full_name, [...(byRepo.get(row.repo_full_name) ?? []), row]);
  }
  return (
    <>
      {[...byRepo.entries()].map(([repo, group]) => (
        <React.Fragment key={repo}>
          <div style={s.groupLabel}>{t("tab.otherRepo", { repo })}</div>
          <div style={s.list}>
            {group.map((row) => (
              <ContextDocRow
                key={`${row.repo_id}:${row.path}`}
                path={row.path}
                tokens={row.tokens}
                missing={row.status === "missing"}
                attached
                notUsedHere
                onToggle={() => onDetach(row)}
              />
            ))}
          </div>
        </React.Fragment>
      ))}
    </>
  );
}
