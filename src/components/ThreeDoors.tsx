"use client";

import { useRouter } from "next/navigation";
import { hapticTap } from "@/lib/minikit-helpers";
import styles from "./ThreeDoors.module.css";

// THREE DOORS ON TOP OF TODAY (Oscar, 10 Oct 2026: "we can have on top a 'post
// your project' and 'support builders' or do favours' 3 actions!"). DESIGN-
// SYSTEM.md, "First tab". One row of three equal tap targets between the bar
// and the hunt card: a mark, a label, one tiny line. Black, white and gray.
//
//   Post your project   opens /post, the existing PostYourApp flow
//   Support builders    scrolls to the project cards on this screen; no new page
//   Do favours          opens /favours
//
// None of the three is the dark primary: the hunt card is the one dark surface
// on this tab. The scroll is smooth, and instant under reduced motion.

export const DOORS = [
  { key: "post", label: "Post your project", line: "Get reviews" },
  { key: "support", label: "Support builders", line: "Review and vote" },
  { key: "favours", label: "Do favours", line: "Earn points" },
] as const;

const marks = {
  post: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  ),
  support: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8.5 12.5 12 16l3.5-3.5" />
    </svg>
  ),
  favours: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.3 2.4 2.4 4.6-5" />
    </svg>
  ),
};

/** Scroll the element with this id into view: smooth, instant under reduced motion. */
export function scrollToId(id: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(id);
  if (!el || typeof el.scrollIntoView !== "function") return false;
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  return true;
}

export function ThreeDoors({ projectsId = "projects" }: { projectsId?: string }) {
  const router = useRouter();
  const go = (key: (typeof DOORS)[number]["key"]) => {
    hapticTap();
    if (key === "post") router.push("/post");
    else if (key === "favours") router.push("/favours");
    else scrollToId(projectsId);
  };
  return (
    <nav className={styles.doors} aria-label="What to do on FAVOUR">
      {DOORS.map((d) => (
        <button key={d.key} type="button" className={`min-h-[44px] ${styles.door}`} onClick={() => go(d.key)} aria-label={d.label}>
          <span className={styles.mark}>{marks[d.key]}</span>
          <span className={styles.label}>{d.label}</span>
          <span className={styles.line}>{d.line}</span>
        </button>
      ))}
    </nav>
  );
}
