"use client";

import { usePathname, useRouter } from "next/navigation";

// THE TAB BAR (19 Oct 2026 deck system). Four doors: Deck, Post (the centre,
// Oscar 11 Oct: "a big centre + Add your project in the bottom menu"), History,
// Profile. Favours left the bar; the old board stays at /board by a text link.
// Our own fixed wrapper, not the kit's SafeAreaView (it broke fixed positioning
// in the World App webview, Oscar Jul 5). Square strokes, 2 px rule, no colour.
const S = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "square" as const, strokeLinejoin: "miter" as const };

const ROUTES = [
  { value: "/", label: "Discover", icon: <svg {...S}><circle cx="12" cy="12" r="9" /><path d="m15 9-2 4-4 2 2-4 4-2Z" /></svg> },
  { value: "/post", label: "Post", icon: <svg {...S}><rect x="3" y="3" width="18" height="18" /><path d="M12 8v8M8 12h8" /></svg>, centre: true },
  { value: "/history", label: "History", icon: <svg {...S}><rect x="3" y="3" width="18" height="18" /><path d="M12 7v5l3 3" /></svg> },
  { value: "/dashboard", label: "Profile", icon: <svg {...S}><rect x="3" y="3" width="18" height="18" /><circle cx="12" cy="10" r="3" /><path d="M6 20c1-4 11-4 12 0" /></svg> },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const activeValue = ROUTES.find((r) =>
    r.value === "/" ? pathname === "/" || pathname.startsWith("/project") || pathname === "/apps" || pathname === "/board" : pathname.startsWith(r.value)
  )?.value ?? "/";

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)", borderTop: "2px solid #000", fontFamily: '"Aeonik", "Aeonik Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="flex items-stretch w-full max-w-lg mx-auto">
        {ROUTES.map((route) => {
          const active = route.value === activeValue;
          return (
            <button
              key={route.value}
              onClick={() => {
                if (active) window.dispatchEvent(new CustomEvent("favour:nav-reselect", { detail: route.value }));
                router.push(route.value);
              }}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-1 min-h-[56px] px-0.5 ${active ? "bg-white text-black" : "bg-white text-black opacity-50"}`}
              style={{ borderRadius: 0, background: "#fff", color: active ? "#194f3d" : "#000" }}
              aria-label={route.label}
              aria-current={active ? "page" : undefined}
            >
              <span className="shrink-0">{route.icon}</span>
              <span className="w-full truncate text-center text-[11px] leading-none font-semibold">{route.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
