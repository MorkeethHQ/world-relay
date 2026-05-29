"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { TopBar } from "@worldcoin/mini-apps-ui-kit-react";

const TaskMapFull = dynamic(() => import("@/components/TaskMapFull"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
      Loading map...
    </div>
  ),
});

export default function MapPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <TopBar
        title="MAP"
        startAdornment={
          <Link href="/" className="text-gray-900 font-bold text-sm tracking-tight">
            RELAY FAVOURS
          </Link>
        }
        endAdornment={
          <Link
            href="/"
            className="h-11 px-3 rounded-full text-xs font-semibold border border-gray-200 text-gray-400 hover:text-gray-900 hover:border-gray-400 transition-all flex items-center gap-1.5"
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
        }
      />

      {/* Map fills remaining space */}
      <main className="flex-1 relative">
        <TaskMapFull />
      </main>
    </div>
  );
}
