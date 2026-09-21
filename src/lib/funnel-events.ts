// THE FIRST-VISIT FUNNEL, added 2026-09-21.
//
// Four steps a brand-new person walks, in order, and the only four names that
// count them:
//
//   mission_viewed     the signed-out onboarding showed today's mission card
//   terms_accepted     they tapped "I agree" on the terms step
//   sign_in_completed  the wallet sign-in came back and the app flipped to authed
//   mission_started    the app opened that mission's proof flow for them
//
// Before these existed the journey could only be guessed: the server counted
// sign_in and proof_submitted, and everything between a stranger arriving and a
// proof landing was invisible. Now each drop-off is a counter.
//
// NO PAYLOAD. These are sent with no data at all, and /api/track keeps only two
// numeric fields for any event, so no wallet address, username or other identifier
// can ride along even by mistake. The counts are per day, never per person.
export const FUNNEL_EVENTS = [
  "mission_viewed",
  "terms_accepted",
  "sign_in_completed",
  "mission_started",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

// Fire-and-forget. The .catch() is deliberate: analytics must never break a
// person mid-journey, and nothing reads the return value.
export function trackFunnelEvent(event: FunnelEvent): void {
  if (typeof window === "undefined") return;
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
  }).catch(() => {});
}

// mission_viewed fires once per device per UTC day. A render is not a view: the
// card re-renders on every state change, and counting renders would make this
// step look many times larger than the step after it, which is the opposite of
// what a funnel is for.
export function trackMissionViewedOncePerDay(): void {
  const key = `favour_mission_viewed:${new Date().toISOString().slice(0, 10)}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    // Storage blocked: skip rather than risk counting every render.
    return;
  }
  trackFunnelEvent("mission_viewed");
}
