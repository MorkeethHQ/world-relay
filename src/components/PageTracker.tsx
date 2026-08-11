"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { funnelClientId } from "@/lib/client-funnel";

export function PageTracker() {
  const pathname = usePathname();
  const last = useRef("");

  useEffect(() => {
    if (pathname === last.current) return;
    last.current = pathname;
    // Persistent per-device id so reach counts each opener once, anonymous
    // included (this is what closes the gap to World's real user count).
    let cid = "";
    try {
      cid = funnelClientId() || "";
    } catch { /* private mode / no storage: skip reach, still track page */ }
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: pathname, cid }),
    }).catch(() => {});
  }, [pathname]);

  return null;
}
