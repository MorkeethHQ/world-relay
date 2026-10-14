// THE SWITCH FOR THE JURY GAME ON THE HOME (day bet, 14 Oct 2026).
//
// On only with NEXT_PUBLIC_FAVOUR_JURY_GAME=1, in every environment (R2 finding
// 6, 14 Oct 2026: a preview build no longer turns it on by itself). The server
// reads the same switch, so with it unset no day count or streak is written or
// served, and merging this code changes nothing until the variable is set.
export function juryGameOn(): boolean {
  return process.env.NEXT_PUBLIC_FAVOUR_JURY_GAME === "1";
}

export type JuryDayView = { date?: string; today: number; goal: number; streak: number; best: number; goalReachedNow?: boolean };

/** Which of two server answers to show. Pure. Answers can arrive out of order
 *  (a slow GET after a verdict), and within one UTC day the count only grows,
 *  so the later day wins, and on the same day the larger count wins. */
export function newerDay(prev: JuryDayView | null, next: JuryDayView): JuryDayView {
  if (!prev) return next;
  const a = prev.date ?? "", b = next.date ?? "";
  if (b !== a) return b > a ? next : prev;
  return next.today >= prev.today ? next : prev;
}

/** The pips of today's card: one per verdict up to the goal. Pure. */
export function pips(day: Pick<JuryDayView, "today" | "goal">): boolean[] {
  return Array.from({ length: day.goal }, (_, i) => i < day.today);
}

/** The line under the count. Every number in it came from the server. Pure. */
export function dayLine(day: JuryDayView | null): string {
  if (!day) return "Swipe right if the proof matches the favour. Left if not.";
  const left = Math.max(0, day.goal - day.today);
  const streak = day.streak >= 2 ? ` · ${day.streak} days in a row` : "";
  if (day.today === 0) return day.streak >= 2 ? `Play today to keep your ${day.streak}-day run` : `${day.goal} swipes a day. Right calls earn a point.`;
  if (left === 0) return `Done for today${streak}`;
  return `${left} to go${streak}`;
}
