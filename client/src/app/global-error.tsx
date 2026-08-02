/* Root-layout error boundary. Only fires when the ROOT layout itself throws
   (providers, theme script, NextIntlClientProvider) — everything error.tsx
   relies on (translations, design tokens from globals.css, Providers) may be
   unavailable here, so this must render its own <html>/<body> and stay fully
   self-contained: inline styles only, no next-intl, no @devdigest/ui. Colors
   are hardcoded to match the dark theme tokens in vendor/ui/styles.css since
   that stylesheet isn't guaranteed to be loaded on this path. */
"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#ededed",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 10,
            padding: "80px 24px",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              display: "grid",
              placeItems: "center",
              background: "rgba(239, 68, 68, 0.12)",
              color: "#ef4444",
              marginBottom: 5,
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            !
          </div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>DevDigest failed to load</div>
          <div style={{ fontSize: 14, color: "#999999", maxWidth: 380, lineHeight: 1.5 }}>
            An unexpected error occurred. Trying again usually fixes it — if it keeps
            happening, reload the page.
          </div>
          <div style={{ marginTop: 12 }}>
            <button
              onClick={reset}
              style={{
                fontSize: 14,
                fontWeight: 600,
                padding: "9px 16px",
                borderRadius: 7,
                border: "1px solid #3a3a3a",
                background: "#1c1c1c",
                color: "#ededed",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
