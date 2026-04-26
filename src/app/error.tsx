"use client";

import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[ErrorBoundary]", error.message, error.stack);
  return (
    <div className="flex flex-col min-h-screen items-center justify-center px-6 bg-[#050505]">
      <div className="flex flex-col items-center gap-6 max-w-lg mx-auto text-center">
        <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.08)]">
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

        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Something went wrong
          </h1>
          <p className="text-gray-600 text-xs font-mono">
            {error.message || error.digest || "Unknown error"}
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            onClick={reset}
            className="bg-white text-black px-6 py-3 rounded-2xl font-semibold text-sm active:scale-[0.97] transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]"
          >
            Try again
          </button>

          <Link
            href="/"
            className="text-gray-400 hover:text-gray-300 text-sm underline underline-offset-4 transition-colors"
          >
            Back to feed
          </Link>
        </div>
      </div>
    </div>
  );
}
