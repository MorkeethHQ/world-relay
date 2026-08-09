"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { MiniKit } from "@worldcoin/minikit-js";

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
      cid = localStorage.getItem("favour_cid") || "";
      if (!cid) {
        cid = crypto.randomUUID();
        localStorage.setItem("favour_cid", cid);
      }
    } catch { /* private mode / no storage: skip reach, still track page */ }
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: pathname, cid }),
    }).catch(() => {});

    // Close the distribution loop: outbound handoff/share events record intent;
    // this records that World actually launched FAVOUR from a deep link. Once
    // per webview session prevents route changes from multiplying one arrival.
    try {
      if (
        MiniKit.isInstalled() &&
        MiniKit.location === "deep-link" &&
        !sessionStorage.getItem("favour_deep_link_open_tracked")
      ) {
        sessionStorage.setItem("favour_deep_link_open_tracked", "true");
        fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "world_app_deep_link_opened" }),
        }).catch(() => {});
      }
    } catch {
      // Browser preview, old World App, or blocked session storage.
    }
  }, [pathname]);

  return null;
}
