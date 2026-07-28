"use client";

import { usePathname, useRouter } from "next/navigation";

const ROUTES = [
  {
    value: "/",
    label: "Favours",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    value: "/polls",
    label: "Polls",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    value: "/history",
    label: "History",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    value: "/leaderboard",
    label: "Ranks",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </svg>
    ),
  },
  {
    value: "/dashboard",
    label: "Profile",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  const activeValue = ROUTES.find((r) =>
    r.value === "/" ? pathname === "/" : pathname.startsWith(r.value)
  )?.value ?? "/";

  return (
    // Hybrid: OUR fixed wrapper (the kit's SafeAreaView broke fixed
    // positioning in the World App webview — "menu doesn't stick to the
    // ground", Oscar Jul 5), with the kit's native Tabs/TabItem inside so the
    // nav stays on World's design language.
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Custom compact items — the kit's TabItem renders far too large on
          mobile with 5 tabs (Oscar Jul 5 night review).

          The items DIVIDE the row (`flex-1 min-w-0`) rather than each claiming a
          fixed `min-w-[56px]`. Five fixed 56px items sum to 280px, which fits a
          320px screen with no margin for a wider label — and on iOS labels do get
          wider (font fallback inside the World App webview, larger accessibility
          text). Dividing the row means the icons cannot exceed the screen no
          matter how wide the labels want to be. Second half of the World review
          fix; the first half is the `overflow-x: clip` rule in globals.css. */}
      <div className="flex items-center pt-1.5 pb-1 w-full max-w-full">
        {ROUTES.map((route) => {
          const active = route.value === activeValue;
          return (
            <button
              key={route.value}
              onClick={() => router.push(route.value)}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 min-h-[44px] px-0.5 transition-colors ${
                active ? "text-gray-900" : "text-gray-400"
              }`}
              aria-label={route.label}
              aria-current={active ? "page" : undefined}
            >
              <span className="shrink-0 [&>svg]:w-[21px] [&>svg]:h-[21px]">{route.icon}</span>
              <span className={`w-full truncate text-center text-[9.5px] leading-none ${active ? "font-semibold" : "font-medium"}`}>{route.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
