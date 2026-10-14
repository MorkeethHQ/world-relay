// THE SWITCH FOR THE JURY GAME ON THE HOME (day bet, 14 Oct 2026).
//
// On: a Vercel preview build, or any build with NEXT_PUBLIC_FAVOUR_JURY_GAME=1
// (the local fixture sets it). Off: a production build without that variable,
// so merging this code changes nothing in production until the variable is set.
// NEXT_PUBLIC_FAVOUR_DEPLOY_ENV is VERCEL_ENV, copied in at build by next.config.ts.
export function juryGameOn(): boolean {
  return process.env.NEXT_PUBLIC_FAVOUR_JURY_GAME === "1" || process.env.NEXT_PUBLIC_FAVOUR_DEPLOY_ENV === "preview";
}

export type JuryDayView = { today: number; goal: number; streak: number; best: number; goalReachedNow?: boolean };

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
