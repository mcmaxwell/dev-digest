/* AvailableDocList — the unattached documents of the active repository.

   Above VIRTUALIZE_ABOVE rows this renders through `useVirtualizer`. Below it
   the plain list renders, which is also what keeps the tab testable in jsdom:
   jsdom has no layout, so a virtualiser measures zero height and would render
   zero rows — a component test over a virtualised list silently asserts
   nothing. Keep every fixture under the threshold. */
"use client";

import React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ProjectDoc } from "@/lib/types";
import { ContextDocRow } from "./ContextDocRow";
import { ROW_HEIGHT, VIRTUALIZE_ABOVE } from "./constants";
import { s } from "./styles";

export function AvailableDocList({
  docs,
  onAttach,
}: {
  docs: ProjectDoc[];
  onAttach: (path: string) => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const virtualized = docs.length > VIRTUALIZE_ABOVE;

  const virtualizer = useVirtualizer({
    count: docs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    enabled: virtualized,
  });

  if (!virtualized) {
    return (
      <div style={s.list}>
        {docs.map((doc) => (
          <ContextDocRow
            key={doc.path}
            path={doc.path}
            tokens={doc.tokens}
            attached={false}
            onToggle={() => onAttach(doc.path)}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={scrollRef} style={{ maxHeight: 520, overflowY: "auto" }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const doc = docs[item.index];
          if (!doc) return null;
          return (
            <div
              key={doc.path}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${item.start}px)`,
              }}
            >
              <ContextDocRow
                path={doc.path}
                tokens={doc.tokens}
                attached={false}
                onToggle={() => onAttach(doc.path)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
