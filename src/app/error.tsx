"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ErrorBoundary]", error);
  }, [error]);

  return (
    <div className="flex flex-col min-h-screen items-center justify-center px-6 bg-gray-50">
      <div className="flex flex-col items-center gap-6 max-w-lg mx-auto text-center">
        <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#191C20"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Something went wrong
          </h1>
          <p className="text-gray-400 text-sm max-w-xs">
            FAVOUR hit an unexpected issue. Give it another shot or head
            back to the feed.
          </p>
          {error?.digest && (
            <p className="text-gray-400 text-xs font-mono">
              ref: {error.digest}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            onClick={reset}
            className="bg-gray-900 text-white px-6 py-3 rounded-2xl font-semibold text-sm active:scale-[0.97] transition-all min-h-[44px]"
          >
            Try again
          </button>

          <Link
            href="/"
            className="text-gray-400 hover:text-gray-500 text-sm underline underline-offset-4 transition-colors min-h-[44px] flex items-center"
          >
            Back to feed
          </Link>
        </div>
      </div>
    </div>
  );
}
