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

/** Apply one server answer: the day to show, and whether this answer may set
 *  off the goal moment. Pure. Only an answer that newerDay keeps may celebrate,
 *  so a late answer from yesterday never stamps 10/10 over today's count
 *  (R2c, 14 Oct 2026). */
export function acceptDay(prev: JuryDayView | null, next: JuryDayView): { day: JuryDayView; celebrate: boolean } {
  const day = newerDay(prev, next);
  return { day, celebrate: day === next && !!next.goalReachedNow };
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

/** Whether a refused verdict should come back to the deck for another try.
 *  Pure. Only the server's "not saved" answer qualifies: the card is still live
 *  on the server (lib/jury.ts writes nothing before it answers that). */
export function verdictRetryable(status: number, body: { error?: unknown } | null | undefined): boolean {
  return status === 409 && typeof body?.error === "string" && /not saved/i.test(body.error);
}
