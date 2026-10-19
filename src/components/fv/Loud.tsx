"use client";

import { useEffect } from "react";

// LOOK C: the one loud screen. One product fills the screen in its own colour,
// giant type, gone after a moment or a tap. Used once per page, for the moment
// something lands (a review accepted, a streak day). No confetti, no bounce.
export function Loud({ num, line, hue, onDone, ms = 1600 }: { num: string; line: string; hue: number; onDone: () => void; ms?: number }) {
  useEffect(() => { const t = setTimeout(onDone, ms); return () => clearTimeout(t); }, [onDone, ms]);
  return (
    <button type="button" className="fv-loud" style={{ background: `hsl(${hue} 90% 60%)` }} onClick={onDone} aria-label="Continue">
      <span className="fv-loud-num">{num}</span>
      <span className="fv-loud-line">{line}</span>
    </button>
  );
}
