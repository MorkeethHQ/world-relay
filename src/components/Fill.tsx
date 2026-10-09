"use client";

import { useEffect, useState } from "react";
import styles from "./Fill.module.css";

// THE FILL-UP (Oscar, 10 Oct 2026: "we should have like a loading state a fill
// up, we can gamify favour SO MUCH!"). DESIGN-SYSTEM.md, rule 6. Two parts,
// shared by the Favours tab, Profile and the project page, so they fill the
// same way:
//
//   Bar     a real fraction and its words. It mounts empty and fills to its
//           value once (a width transition, 700 ms ease-out), so a step done on
//           return is seen to land. Never drawn without a real fraction behind it.
//   Loader  a track that fills while a screen is read (1.6 s ease-out), with
//           three still slots under it, the shape of the rows to come.
//
// Both are CSS transitions, none under prefers-reduced-motion. Nothing spins,
// pulses or blinks. Ink on gray; no colour.

/** True on the first frame after mount, so a width set then transitions from 0. */
function useGo(): boolean {
  const [go, setGo] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGo(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return go;
}

export function Bar({ done, of, label, className }: { done: number; of: number; label: string; className?: string }) {
  const share = of > 0 ? Math.max(0, Math.min(1, done / of)) : 0;
  const go = useGo();
  return (
    <div className={`${styles.bar} ${className ?? ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={of} aria-valuenow={done} aria-label={label}>
      <span className={styles.track} aria-hidden="true"><span className={styles.fill} style={{ width: go ? `${Math.round(share * 100)}%` : "0%" }} /></span>
      <small>{label}</small>
    </div>
  );
}

/** The loader. `label` is the aria label and the line, which ends in an ellipsis: "Reading favours…". */
export function Loader({ label }: { label: string }) {
  const go = useGo();
  return (
    <div className={styles.loader} aria-busy="true" aria-label={label}>
      <p className={styles.loaderLine}>{label}…</p>
      <span className={styles.loaderTrack} aria-hidden="true"><span className={`${styles.loaderFill} ${go ? styles.loaderGo : ""}`} /></span>
      <div className={styles.ghosts} aria-hidden="true">
        {[0, 1, 2].map((i) => <span key={i} className={styles.ghost} />)}
      </div>
    </div>
  );
}
