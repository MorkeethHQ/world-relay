"use client";

import { dayLine, pips, type JuryDayView } from "@/lib/jury-game";

// THE HOME'S FIRST CARD WHEN THE JURY GAME IS ON (day bet, 14 Oct 2026).
// People tap far more than they write (2,868 verdicts against 93 posts,
// NEW-TAKE §1, relayed), so the game they already play leads the screen.
// Today's count, the pips and the streak come from GET /api/jury/record. With
// no number from the server, the card shows no number.
export function JuryGameCard({ day, onPlay }: { day: JuryDayView | null; onPlay: () => void }) {
  const done = !!day && day.today >= day.goal;
  return (
    <section className="mx-6 mt-4 rounded-3xl bg-gray-900 px-5 pt-5 pb-5 text-white" aria-label="Real or not, today's game">
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-bold tracking-widest text-white/60">REAL OR NOT</p>
        {day && day.streak >= 2 && <p className="text-[12px] font-semibold text-white/80 tabular-nums">{day.streak} days in a row</p>}
      </div>
      {day ? (
        <p className="mt-3 leading-none">
          <span className="text-[44px] font-extrabold tabular-nums tracking-tight">{Math.min(day.today, 999)}</span>
          <span className="text-[20px] font-semibold text-white/50 tabular-nums"> / {day.goal} today</span>
        </p>
      ) : (
        <p className="mt-3 text-[22px] font-bold leading-tight">Is the proof real?</p>
      )}
      {day && (
        <div className="mt-4 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${day.goal}, minmax(0, 1fr))` }} aria-hidden>
          {pips(day).map((on, i) => (
            <span key={i} className={`h-2.5 rounded-full ${on ? "bg-white" : "bg-white/15"}`} />
          ))}
        </div>
      )}
      <p className="mt-4 text-[13px] text-white/70">{dayLine(day)}</p>
      <button
        type="button"
        onClick={onPlay}
        className="mt-4 w-full min-h-[52px] rounded-full bg-white text-gray-900 text-[16px] font-bold active:scale-[0.98] transition-transform"
      >
        {done ? "Keep swiping" : day && day.today > 0 ? "Continue" : "Play"}
      </button>
    </section>
  );
}
