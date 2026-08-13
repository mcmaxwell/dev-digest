/* DocTree — the document list pane.

   One tab stop with a roving `tabIndex` and arrow-key movement between rows,
   so the whole tree is reachable without a pointer. Above VIRTUALIZE_ABOVE
   rows it renders through `useVirtualizer`; in that path the row being focused
   may not be mounted yet, so keyboard movement scrolls it into view FIRST and
   `aria-setsize`/`aria-posinset` are set by hand (the DOM no longer holds every
   row for a screen reader to count). */
"use client";

import React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ProjectDoc } from "@/lib/types";
import { splitPath } from "../../helpers";
import { ROW_HEIGHT, VIRTUALIZE_ABOVE } from "../../constants";
import { s } from "../../styles";

interface DocTreeProps {
  docs: ProjectDoc[];
  selected: string | null;
  onSelect: (path: string) => void;
  label: string;
}

export function DocTree({ docs, selected, onSelect, label }: DocTreeProps) {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const selectedIndex = docs.findIndex((doc) => doc.path === selected);
  // The roving tab stop: the selected row, or the first one when nothing is
  // selected yet.
  const [focusIndex, setFocusIndex] = React.useState(0);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : Math.min(focusIndex, docs.length - 1);

  const virtualized = docs.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: docs.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: virtualized,
  });

  const focusRow = React.useCallback(
    (index: number) => {
      setFocusIndex(index);
      if (virtualized) {
        // The row may not be mounted; scroll it in before moving DOM focus.
        virtualizer.scrollToIndex(index, { align: "auto" });
      }
      // Focus after the browser has had a chance to mount the row.
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector<HTMLButtonElement>(`[data-doc-index="${index}"]`)
          ?.focus();
      });
    },
    [virtualized, virtualizer],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (docs.length === 0) return;
    const move = (next: number) => {
      e.preventDefault();
      focusRow(Math.max(0, Math.min(docs.length - 1, next)));
    };
    if (e.key === "ArrowDown") move(activeIndex + 1);
    else if (e.key === "ArrowUp") move(activeIndex - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(docs.length - 1);
    else if (e.key === "Enter" || e.key === " ") {
      const doc = docs[activeIndex];
      if (doc) {
        e.preventDefault();
        onSelect(doc.path);
      }
    }
  };

  const renderRow = (doc: ProjectDoc, index: number, style?: React.CSSProperties) => {
    const { dir, file } = splitPath(doc.path);
    const isSelected = doc.path === selected;
    return (
      <button
        key={doc.path}
        type="button"
        role="option"
        data-doc-index={index}
        aria-selected={isSelected}
        aria-setsize={docs.length}
        aria-posinset={index + 1}
        aria-label={doc.path}
        title={doc.path}
        tabIndex={index === activeIndex ? 0 : -1}
        onClick={() => {
          setFocusIndex(index);
          onSelect(doc.path);
        }}
        style={{ ...s.row(isSelected), ...style }}
      >
        {dir && <span style={s.rowDir}>{dir}</span>}
        <span className="mono" style={s.rowFile}>
          {file}
        </span>
      </button>
    );
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={s.list}
      data-testid="doc-tree"
    >
      {virtualized ? (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const doc = docs[item.index];
            if (!doc) return null;
            return renderRow(doc, item.index, {
              position: "absolute",
              top: 0,
              left: 0,
              transform: `translateY(${item.start}px)`,
              height: item.size,
            });
          })}
        </div>
      ) : (
        docs.map((doc, index) => renderRow(doc, index))
      )}
    </div>
  );
}
