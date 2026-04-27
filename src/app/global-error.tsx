"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console for debugging — never expose to the user
    console.error("[GlobalErrorBoundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#FAFAFA",
          color: "#1a1a1a",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "24px",
            maxWidth: "28rem",
            textAlign: "center",
            padding: "0 24px",
          }}
        >
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              backgroundColor: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 16px rgba(0,0,0,0.06)",
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="black"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>

          <div>
            <h1
              style={{
                fontSize: "1.875rem",
                fontWeight: 700,
                letterSpacing: "-0.025em",
                margin: "0 0 12px",
              }}
            >
              Something went wrong
            </h1>
            <p style={{ color: "#9ca3af", fontSize: "0.875rem", margin: 0 }}>
              RELAY FAVOURS hit a critical error. Try reloading the page.
            </p>
            {error?.digest && (
              <p
                style={{
                  color: "#4b5563",
                  fontSize: "0.75rem",
                  fontFamily: "monospace",
                  marginTop: "8px",
                }}
              >
                ref: {error.digest}
              </p>
            )}
          </div>

          <button
            onClick={reset}
            style={{
              backgroundColor: "#000",
              color: "white",
              padding: "12px 24px",
              borderRadius: "16px",
              fontWeight: 600,
              fontSize: "0.875rem",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
