"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const TaskMapFull = dynamic(() => import("@/components/TaskMapFull"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-[#9BA3AE] text-sm">
      Loading map...
    </div>
  ),
});

export default function MapPage() {
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#E9ECF0] bg-white">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-[#191C20] font-bold text-sm tracking-tight">
            RELAY FAVOURS
          </span>
          <span className="text-xs text-[#9BA3AE] font-mono">MAP</span>
        </Link>
        <Link
          href="/"
          className="h-11 px-3 rounded-full text-xs font-semibold border border-[#E9ECF0] text-[#9BA3AE] hover:text-[#191C20] hover:border-[#9BA3AE] transition-all flex items-center gap-1.5"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Feed
        </Link>
      </header>

      {/* Map fills remaining space */}
      <main className="flex-1 relative">
        <TaskMapFull />
      </main>
    </div>
  );
}
