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
//
// WHICH BUTTON, added 2026-09-22. On 21 Sep, 4 people signed in and 0 started the
// mission, and the four steps above could not say why: step 0 offers several ways
// in, and only one queues the mission. A production walk showed the mission path
// works end to end, so the 4 came in some other way. One tap event per step-0 way
// in means the next drop-off is read, not guessed:
//
//   mission_tapped         "Do today's mission"
//   get_started_tapped     the tour button ("How FAVOUR works", or "Get started")
//   for_companies_tapped   "For companies"
//   piece_tapped           "Do a piece and earn"
export const FUNNEL_EVENTS = [
  "mission_viewed",
  "terms_accepted",
  "sign_in_completed",
  "mission_started",
  "mission_tapped",
  "get_started_tapped",
  "for_companies_tapped",
  "piece_tapped",
  // 2026-10-05, R19: the campaign stage on step 0.
  "welcome_tapped",
  "demo_brand_tapped",
  // 2026-10-15: what "sign in again" costs since the hard session gates (PR 55).
  // Once per device per UTC day each, by trackReauthOncePerDay below.
  "reauth_asked",
  "reauth_ok",
  "reauth_failed",
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

// The three sign-in-again counters: a signature was asked, it set a session, or
// it did not (declined, another wallet, the exchange failed). Once per device
// per UTC day each, so asked can be read against DAU. No payload.
export function trackReauthOncePerDay(event: "reauth_asked" | "reauth_ok" | "reauth_failed"): void {
  const key = `favour_${event}:${new Date().toISOString().slice(0, 10)}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    return;
  }
  trackFunnelEvent(event);
}
