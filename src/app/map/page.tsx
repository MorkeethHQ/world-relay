"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const TaskMapFull = dynamic(() => import("@/components/TaskMapFull"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
      Loading map...
    </div>
  ),
});

export default function MapPage() {
  return (
    <div className="min-h-screen bg-[#050505] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-white font-bold text-sm tracking-tight">
            RELAY
          </span>
          <span className="text-[10px] text-gray-500 font-mono">MAP</span>
        </Link>
        <Link
          href="/"
          className="h-8 px-3 rounded-full text-[11px] font-semibold border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-all flex items-center gap-1.5"
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
