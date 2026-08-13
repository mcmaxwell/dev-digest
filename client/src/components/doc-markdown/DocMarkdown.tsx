/* DocMarkdown — read-only renderer for a project document's body.

   A project document is written by someone other than the person reading it —
   a colleague, a contractor, a vendored dependency, or an attacker who opened a
   PR adding a file under specs/. So this renderer is deliberately NOT the
   vendored `<Markdown>` primitive:

   - Raw HTML is never parsed. `react-markdown` escapes it unless `rehype-raw`
     is added, so a `<script>` tag in a document renders as literal text.
   - `urlTransform` narrows the library's default scheme allowlist
     (`http`, `https`, `ircs`, `mailto`, `xmpp`) down to `http`/`https` only.
     `javascript:` is already neutered by the default; the narrowing is what
     removes the rest.

   It is a new app-level component rather than an edit to
   `vendor/ui/primitives/Markdown.tsx`: the vendored kit is frozen, and its
   existing consumers render content that does not want the narrower list. */
"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { s } from "./styles";

/**
 * Allow relative URLs and absolute `http(s)` ones; everything else becomes an
 * empty href. Scheme detection matches the library's own rule: the first `:`
 * counts only when it precedes any `?`, `#` or `/`.
 */
export function safeUrlTransform(url: string): string {
  const colon = url.indexOf(":");
  const question = url.indexOf("?");
  const hash = url.indexOf("#");
  const slash = url.indexOf("/");

  const relative =
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (question !== -1 && colon > question) ||
    (hash !== -1 && colon > hash);
  if (relative) return url;

  const scheme = url.slice(0, colon).toLowerCase();
  return scheme === "http" || scheme === "https" ? url : "";
}

export function DocMarkdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={s.wrap} data-testid="doc-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeUrlTransform}
        components={{
          h1: ({ children: c }) => <h1 style={s.h1}>{c}</h1>,
          h2: ({ children: c }) => <h2 style={s.h2}>{c}</h2>,
          h3: ({ children: c }) => <h3 style={s.h3}>{c}</h3>,
          p: ({ children: c }) => <p style={s.p}>{c}</p>,
          ul: ({ children: c }) => <ul style={s.list}>{c}</ul>,
          ol: ({ children: c }) => <ol style={s.list}>{c}</ol>,
          li: ({ children: c }) => <li style={s.li}>{c}</li>,
          blockquote: ({ children: c }) => <blockquote style={s.quote}>{c}</blockquote>,
          pre: ({ children: c }) => (
            <pre className="mono" style={s.pre}>
              {c}
            </pre>
          ),
          code: ({ children: c }) => (
            <code className="mono" style={s.code}>
              {c}
            </code>
          ),
          a: ({ children: c, href }) => (
            <a href={href} style={s.link} rel="noopener noreferrer nofollow" target="_blank">
              {c}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
