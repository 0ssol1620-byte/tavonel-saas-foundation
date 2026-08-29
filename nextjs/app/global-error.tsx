"use client";

/**
 * The last resort.
 *
 * `global-error.tsx` replaces the root layout itself, so it cannot rely on the stylesheet, the
 * fonts or any component the layout brings -- it has to render correctly with nothing loaded.
 * Everything here is therefore inline and self-contained, and the palette is written out rather
 * than read from tokens that may never have arrived.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#08090A", color: "#9AA3A8" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px 20px",
            fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
            lineHeight: 1.65,
          }}
        >
          <div style={{ maxWidth: 460, width: "100%" }}>
            <p
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11,
                letterSpacing: "0.16em",
                color: "#7D878D",
                margin: "0 0 14px",
              }}
            >
              TAVONEL &middot; SOMETHING FAILED
            </p>
            <h1 style={{ margin: "0 0 14px", fontSize: 30, lineHeight: 1.2, color: "#EDEAE4", fontWeight: 600 }}>
              The application stopped loading.
            </h1>
            <p style={{ margin: "0 0 22px", fontSize: 15.5 }}>
              This failed before the page could be drawn. Your documents, credits and access are
              unaffected &mdash; none of them can be changed by a failure at this stage.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                font: "inherit",
                fontSize: 13,
                letterSpacing: "0.08em",
                color: "#08090A",
                background: "#7BE0BE",
                border: 0,
                borderRadius: 3,
                padding: "11px 18px",
                cursor: "pointer",
              }}
            >
              Reload
            </button>
            {error.digest ? (
              <p
                style={{
                  margin: "20px 0 0",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 12,
                  color: "#7D878D",
                }}
              >
                Reference {error.digest}
              </p>
            ) : null}
          </div>
        </div>
      </body>
    </html>
  );
}
