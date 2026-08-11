"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrBlastRadius } from "@devdigest/shared";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { toMermaid } from "./toMermaid";
import { s } from "./styles";

/**
 * The graph view.
 *
 * `MermaidDiagram` imports mermaid LAZILY, so the library is only fetched when a
 * reader actually switches to this view - the tree is the default and the
 * complete answer, and most readers never leave it.
 *
 * The diagram SOURCE is built by the pure `toMermaid`, which is where escaping
 * and the synthetic node ids live. This component only decides between a diagram
 * and a sentence: a diagram with nodes but no edges is a row of disconnected
 * boxes, which says less than the sentence does.
 */
export function BlastGraph({ blast }: { blast: PrBlastRadius }) {
  const t = useTranslations("blast");
  const chart = React.useMemo(() => toMermaid(blast), [blast]);

  if (!chart) return <p style={s.quiet}>{t("graph.empty")}</p>;

  return (
    <figure style={{ margin: 0 }} aria-label={t("graph.ariaLabel")}>
      <MermaidDiagram chart={chart} />
    </figure>
  );
}
