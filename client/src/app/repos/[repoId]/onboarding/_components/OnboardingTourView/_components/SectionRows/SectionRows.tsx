/* SectionRows — the ordered rows of one section, shaped per kind.

   Every path here was verified against the clone before it was stored, so every
   one of them is an `Open` link to the GitHub blob PINNED TO THE GENERATION
   COMMIT. There is no in-product source viewer and this page does not pretend
   otherwise: the links leave. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { githubBlobUrl } from "@/lib/github-urls";
import type { OnboardingSection } from "@/lib/types";
import { CopyButton } from "../CopyButton";
import { truncatePath } from "../../helpers";
import { s } from "../../styles";

interface SectionRowsProps {
  section: OnboardingSection;
  repoFullName: string;
  headSha: string;
}

/** One repo-relative path, truncated for width but whole for a screen reader. */
function PathLink({
  path,
  line,
  repoFullName,
  headSha,
}: {
  path: string;
  line?: number | null;
  repoFullName: string;
  headSha: string;
}) {
  const t = useTranslations("onboarding");
  return (
    <a
      href={githubBlobUrl(repoFullName, headSha, path, line ?? undefined)}
      target="_blank"
      rel="noopener noreferrer"
      title={path}
      aria-label={t("openOnGithub", { path })}
      className="mono"
      style={{ ...s.rowPath, color: "var(--accent-text)" }}
    >
      {truncatePath(path)}
      {line != null ? `:${line}` : ""}
    </a>
  );
}

export function SectionRows({ section, repoFullName, headSha }: SectionRowsProps) {
  const t = useTranslations("onboarding");

  if (section.kind === "architecture") return null;

  if (section.kind === "critical_paths") {
    return (
      <ul style={s.rows}>
        {section.items.map((item) => (
          <li key={item.path} style={s.row}>
            <div style={s.rowMain}>
              <PathLink path={item.path} repoFullName={repoFullName} headSha={headSha} />
              <span style={s.rowReason}>{item.reason}</span>
            </div>
            {item.rank_percentile != null && (
              <span style={s.rowMeta}>
                {t("rows.rank", { percentile: Math.round(item.rank_percentile * 100) / 100 })}
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  }

  if (section.kind === "run_locally") {
    return (
      <ul style={s.rows}>
        {section.items.map((item) => (
          <li key={item.step} style={s.row}>
            <span style={s.ordinal}>{item.step}.</span>
            <div style={s.rowMain}>
              <pre className="mono" style={s.command}>
                {item.command}
              </pre>
              <span style={{ ...s.rowMeta, display: "inline-flex", gap: 5, alignItems: "baseline" }}>
                {t("rows.sourcePrefix")}
                <PathLink path={item.source} repoFullName={repoFullName} headSha={headSha} />
              </span>
            </div>
            <CopyButton
              value={item.command}
              label={t("copyCommand")}
              copiedLabel={t("copiedCommand")}
            />
          </li>
        ))}
      </ul>
    );
  }

  if (section.kind === "reading_path") {
    return (
      <ul style={s.rows}>
        {section.items.map((item) => (
          <li key={item.path} style={s.row}>
            <span style={s.ordinal}>{item.order}.</span>
            <div style={s.rowMain}>
              <PathLink path={item.path} repoFullName={repoFullName} headSha={headSha} />
              <span style={s.rowReason}>{item.reason}</span>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul style={s.rows}>
      {section.items.map((item, i) => (
        <li key={`${item.origin}-${item.issue_number ?? item.path}-${item.line ?? i}`} style={s.row}>
          <Icon.ListChecks size={14} style={{ color: "var(--text-muted)", marginTop: 2 }} />
          <div style={s.rowMain}>
            <span style={s.rowReason}>{item.title}</span>
            {item.origin === "issue" && item.issue_number != null ? (
              <span style={s.rowMeta}>{t("rows.issue", { number: item.issue_number })}</span>
            ) : item.path ? (
              <PathLink
                path={item.path}
                line={item.line}
                repoFullName={repoFullName}
                headSha={headSha}
              />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
