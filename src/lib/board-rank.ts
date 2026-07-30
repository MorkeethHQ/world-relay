import type { Task } from "./types";
import { isRealMoney } from "./reward";
import { getFeaturedCampaign } from "./campaigns";

// SINGLE SOURCE OF TRUTH for what shows on the board and in what order.
// The rules live in BOARD-RULES.md; the constants and tiers here ARE those
// rules. Change them together with the doc and src/__tests__/board-rank.test.ts,
// never ad hoc in a component.

export const BOARD_CAP = 30;
export const DUPLICATE_DESC_CAP = 2;
export const STALE_AFTER_MS = 7 * 24 * 3600_000;
export const URGENT_DEADLINE_HOURS = 4;
export const URGENT_FUNDED_BOUNTY_USDC = 15;
// R1: at most this many feedback-category tasks among the first FEEDBACK_WINDOW
// cards; overflow defers below the window so question-tasks can't drown the board.
export const FEEDBACK_WINDOW = 15;
export const FEEDBACK_MAX_IN_WINDOW = 3;
// R2: polls render after this many task cards (never lead the board), capped.
export const POLL_INSERT_AFTER = 3;
export const POLL_CARDS_MAX = 2;

export type UserLocation = { lat: number; lng: number } | null;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// R3: an open task is board-visible only if it is a points task or carries real
// on-chain escrow. (category === "feedback" used to bypass the funded check, which
// let unfunded USDC question-tasks crowd the board.) Claimed tasks show only to
// their claimant.
export function isBoardVisible(t: Task, userId: string | null, now: number): boolean {
  if (t.status === "expired" || t.status === "cancelled") return false;
  if (t.status === "open") {
    if (new Date(t.deadline).getTime() < now) return false;
    // A points task must actually reward something: a 0-value points task shows a
    // "0 pts" badge and reads as broken/empty inventory, so keep it off the board.
    if (t.rewardType === "points") return t.bountyUsdc > 0;
    // R3 amendment (escrow-v2, demand-gated custody): an OPEN v2 task is
    // legitimately unfunded — the poster funds at claimant-accept, so it must
    // be visible for a claimant to exist at all. The badge renders the honest
    // state ("funds on accept"); once funded, isRealMoney promotes it to the
    // FUNDED tier. Legacy "usdc" keeps the strict funded-only rule.
    if (t.rewardType === "usdc-v2") return t.bountyUsdc > 0;
    return isRealMoney(t);
  }
  return t.status === "claimed" && !!userId && t.claimant === userId;
}

// R5 tier order. Lower tier ranks higher on the board.
export const TIER = {
  MY_CLAIM: 0, // my in-progress favours never get buried
  FUNDED: 1, // real money is the product
  FEATURED: 2, // the points journey (featured campaign) is the current funnel
  POINTS: 3, // other points tasks
  FEEDBACK: 4, // question/poll-type tasks come after actionable ones
  STALE: 5, // open >7 days with no claim
} as const;

// Staleness applies to SINGLE-completion tasks only: an evergreen
// multi-completion task (campaign furniture, maxCompletions > 1) reopens after
// every pass without touching createdAt, so age says nothing about it being
// dead — without this exemption the featured welcome journey would sink to the
// bottom tier 7 days after seeding.
export function isStale(t: Task, now: number): boolean {
  return (
    t.status === "open" &&
    !t.claimant &&
    (t.maxCompletions ?? 1) <= 1 &&
    now - new Date(t.createdAt).getTime() > STALE_AFTER_MS
  );
}

export function boardTier(t: Task, userId: string | null, featuredCampaignId: string | null, now: number): number {
  if (t.status === "claimed" && !!userId && t.claimant === userId) return TIER.MY_CLAIM;
  if (isStale(t, now)) return TIER.STALE;
  if (isRealMoney(t)) return TIER.FUNDED;
  if (featuredCampaignId && t.campaignId === featuredCampaignId) return TIER.FEATURED;
  if (t.category === "feedback") return TIER.FEEDBACK;
  return TIER.POINTS;
}

// Urgency is a within-tier boost only: a closing deadline, or a big FUNDED
// bounty. Points amounts are never "urgent" (points are not money).
export function isUrgent(t: Task, now: number): boolean {
  const hoursLeft = (new Date(t.deadline).getTime() - now) / 3600_000;
  return hoursLeft < URGENT_DEADLINE_HOURS || (isRealMoney(t) && t.bountyUsdc >= URGENT_FUNDED_BOUNTY_USDC);
}

export function rankBoard(
  tasks: Task[],
  opts: { userId: string | null; userLocation: UserLocation; now: number }
): Task[] {
  const { userId, userLocation, now } = opts;
  const featuredId = getFeaturedCampaign()?.id ?? null;
  return [...tasks].sort((a, b) => {
    const ta = boardTier(a, userId, featuredId, now);
    const tb = boardTier(b, userId, featuredId, now);
    if (ta !== tb) return ta - tb;
    // Within a tier, do-something tasks come before answer-a-question tasks
    // (R1's spirit): a campaign's feedback tasks must not be its first cards.
    const fa = a.category === "feedback";
    const fb = b.category === "feedback";
    if (fa !== fb) return fa ? 1 : -1;
    const ua = isUrgent(a, now);
    const ub = isUrgent(b, now);
    if (ua !== ub) return ua ? -1 : 1;
    if (userLocation && a.lat && a.lng && b.lat && b.lng) {
      const d =
        haversineKm(userLocation.lat, userLocation.lng, a.lat, a.lng) -
        haversineKm(userLocation.lat, userLocation.lng, b.lat, b.lng);
      if (d !== 0) return d;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

// R1 pass: demote feedback tasks past the cap out of the first FEEDBACK_WINDOW
// slots. Pure reordering — never drops a task. Exempt tasks (the user's own)
// neither defer nor count toward the cap.
export function demoteFeedbackOverflow(ranked: Task[], isExempt: (t: Task) => boolean): Task[] {
  const placed: Task[] = [];
  const deferred: Task[] = [];
  let feedbackInWindow = 0;
  for (const t of ranked) {
    if (
      placed.length < FEEDBACK_WINDOW &&
      t.category === "feedback" &&
      !isExempt(t) &&
      feedbackInWindow >= FEEDBACK_MAX_IN_WINDOW
    ) {
      deferred.push(t);
      continue;
    }
    if (placed.length < FEEDBACK_WINDOW && t.category === "feedback") feedbackInWindow++;
    placed.push(t);
    if (placed.length === FEEDBACK_WINDOW && deferred.length) {
      placed.push(...deferred);
      deferred.length = 0;
    }
  }
  placed.push(...deferred);
  return placed;
}

// Curation on top of the ranked list: duplicate-description collapse, the R1
// feedback share cap, and the board cap. The user's own posts/claims are exempt
// from every cap and never hidden.
export function curateBoard(ranked: Task[], userId: string | null): Task[] {
  const isMine = (t: Task) => !!userId && (t.poster === userId || t.claimant === userId);

  const descCounts = new Map<string, number>();
  const deduped = ranked.filter((t) => {
    if (isMine(t)) return true;
    const key = t.description.toLowerCase().replace(/\s+/g, " ").trim();
    const n = descCounts.get(key) || 0;
    if (n >= DUPLICATE_DESC_CAP) return false;
    descCounts.set(key, n + 1);
    return true;
  });

  const placed = demoteFeedbackOverflow(deduped, isMine);

  if (placed.length <= BOARD_CAP) return placed;
  return placed.slice(0, BOARD_CAP).concat(placed.slice(BOARD_CAP).filter(isMine));
}

// Server-side enforcement of R1 + R5 in GET /api/tasks: open tasks come first in
// board order (ranked anonymously — no user identity or location server-side),
// with feedback overflow demoted; everything else (claimed/completed/cancelled)
// follows in recency order. NEVER drops a task — display caps (BOARD_CAP,
// duplicate collapse, R2 poll placement) are the client's job, because only the
// client knows whose board it is. Agents and API consumers therefore see the
// same composition rules as the app.
export function orderBoardForApi(tasks: Task[], now: number): Task[] {
  const open = tasks.filter((t) => t.status === "open");
  const rest = tasks.filter((t) => t.status !== "open");
  const ranked = rankBoard(open, { userId: null, userLocation: null, now });
  return demoteFeedbackOverflow(ranked, () => false).concat(rest);
}
