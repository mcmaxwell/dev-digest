/* SectionCard — one of the five sections, as an independently collapsible card.

   Three things this component is careful about:

   - Every section renders, always, including the ones with nothing in them.
     A repository with no run scripts still gets a "How to run locally" card,
     and it says what was looked for. Sections are never dropped from the page
     or from its navigation.
   - Prose goes through DocMarkdown, not the vendored <Markdown> primitive: this
     body was written by a model that read attacker-influenceable files, so raw
     HTML is escaped and the URL scheme allowlist is narrowed to http/https.
   - The diagram goes through MermaidDiagram, which returns null on an
     unparseable source. The prose is then left standing on its own — no blank
     frame, no thrown boundary. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { DocMarkdown } from "@/components/doc-markdown";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { githubBlobUrl } from "@/lib/github-urls";
import type { OnboardingSection } from "@/lib/types";
import { SectionRows } from "../SectionRows";
import { sectionDomId } from "../../constants";
import { sectionHasContent, truncatePath } from "../../helpers";
import { s } from "../../styles";

interface SectionCardProps {
  section: OnboardingSection;
  repoFullName: string;
  headSha: string;
}

export function SectionCard({ section, repoFullName, headSha }: SectionCardProps) {
  const t = useTranslations("onboarding");
  // Expanded by default; the state is deliberately not persisted.
  const [open, setOpen] = React.useState(true);
  const bodyId = `${sectionDomId(section.kind)}-body`;
  const hasContent = sectionHasContent(section);

  return (
    <section style={s.card} data-testid={`section-${section.kind}`}>
      <button
        type="button"
        style={s.cardHead}
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={open ? t("collapse") : t("expand")}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <Icon.ChevronDown size={15} /> : <Icon.ChevronRight size={15} />}
        {/* tabIndex -1 so the page nav can move FOCUS here, not just scroll. */}
        <h2 id={sectionDomId(section.kind)} tabIndex={-1} style={s.cardTitle}>
          {section.title}
        </h2>
        {section.status === "no_graph" && (
          <span style={s.marker}>
            <Icon.Info size={12} />
            {t("status.noGraph")}
          </span>
        )}
      </button>

      {open && (
        <div id={bodyId} style={s.cardBody}>
          {hasContent ? (
            <>
              {section.body.trim().length > 0 && <DocMarkdown>{section.body}</DocMarkdown>}
              {section.kind === "architecture" && section.diagram && (
                <MermaidDiagram chart={section.diagram} />
              )}
              <SectionRows section={section} repoFullName={repoFullName} headSha={headSha} />
            </>
          ) : (
            <p style={s.empty}>{t(`empty.${section.kind}`)}</p>
          )}

          {section.links.length > 0 && (
            <div style={s.links}>
              {section.links.map((link) => (
                <a
                  key={link.path}
                  href={githubBlobUrl(repoFullName, headSha, link.path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link.path}
                  aria-label={t("openOnGithub", { path: link.path })}
                  style={{ color: "var(--accent-text)" }}
                >
                  {link.label} <span className="mono">{truncatePath(link.path, 32)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
