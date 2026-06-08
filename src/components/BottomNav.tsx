"use client";

import { usePathname, useRouter } from "next/navigation";
import { SafeAreaView } from "@worldcoin/mini-apps-ui-kit-react";

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
    value: "/leaderboard",
    label: "Agents",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    value: "/xmtp",
    label: "Chat",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
    <SafeAreaView edges={["bottom"]} className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200" role="navigation" aria-label="Main navigation">
      <div className="flex items-center justify-around py-2">
        {ROUTES.map((route) => {
          const active = route.value === activeValue;
          return (
            <button
              key={route.value}
              onClick={() => router.push(route.value)}
              className={`flex flex-col items-center justify-center gap-1 min-w-[64px] min-h-[44px] transition-colors ${
                active ? "text-gray-900" : "text-gray-400"
              }`}
              aria-label={route.label}
              aria-current={active ? "page" : undefined}
            >
              {route.icon}
              <span className="text-[10px] font-medium leading-none">{route.label}</span>
            </button>
          );
        })}
      </div>
    </SafeAreaView>
  );
}
