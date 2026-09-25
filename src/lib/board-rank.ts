import type { Task } from "./types";
import { isRealMoney } from "./reward";
import { isHiddenTask } from "./task-serializer";
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
// R15: a company campaign piece is not a favour. It is reached through the earn
// card and the campaign cards, which label the company's trust. Only an OPEN piece
// is kept off the favour list; a piece someone has claimed still shows to them.
export function isCompanyPiece(t: Pick<Task, "companyCampaignId">): boolean {
  return typeof t.companyCampaignId === "string" && t.companyCampaignId.length > 0;
}

export const isHidden = isHiddenTask;

// R16: text that reads as a money pitch rather than a favour. Deliberately
// narrow, matched on the phrases seen live ("just want to make money"), because a
// broad filter that demotes honest favours is worse than one that misses.
const SPAM_RE = /\b(make|making|earn|earning)\s+(easy\s+|quick\s+|fast\s+|free\s+)?money\b|\bget\s+rich\b|\bguaranteed\s+(income|profit|returns?)\b|\bdouble\s+your\s+(money|crypto)\b/i;
export function looksLikeSpam(text: string | null | undefined): boolean {
  return !!text && SPAM_RE.test(text);
}

export function isBoardVisible(t: Task, userId: string | null, now: number): boolean {
  if (t.status === "expired" || t.status === "cancelled") return false;
  // R16: operator-hidden (scripts/hide-item.mjs) never shows, not even to its
  // claimant. The record is kept; hiding is never deleting.
  if (isHidden(t)) return false;
  if (t.status === "open") {
    if (new Date(t.deadline).getTime() < now) return false;
    if (isCompanyPiece(t)) return false;
    // R16: a favour with no room left cannot be done by anyone, so it is not
    // on offer.
    if ((t.completionCount ?? 0) >= Math.max(1, t.maxCompletions ?? 1)) return false;
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

const PHOTO_CATEGORIES = new Set(["photo", "delivery", "errand", "check-in"]);

function isRemoteLocation(loc?: string | null): boolean {
  if (!loc) return true;
  const l = loc.trim().toLowerCase();
  return l === "online" || l === "remote" || l === "anywhere" || l === "worldwide" || l.startsWith("any ");
}

// Best open favour for a first-time user: online, text-friendly, points-only.
export function pickStarterFavour(tasks: Task[], userId: string | null, now = Date.now()): Task | null {
  const candidates = tasks.filter(
    (t) =>
      isBoardVisible(t, userId, now) &&
      t.status === "open" &&
      t.poster !== userId &&
      t.rewardType === "points" &&
      t.bountyUsdc > 0 &&
      // R16: the starter card leads the screen, so it obeys the lead rule.
      !looksLikeSpam(t.description),
  );
  if (candidates.length === 0) return null;

  const score = (t: Task): number => {
    let s = 0;
    if (t.category === "feedback") s += 50;
    else if (t.category === "social") s += 40;
    else if (t.category === "review") s += 20;
    if (isRemoteLocation(t.location)) s += 30;
    if (!PHOTO_CATEGORIES.has(t.category)) s += 25;
    const desc = t.description.toLowerCase();
    if (desc.includes("rate") || desc.includes("tell us") || desc.includes("honest")) s += 15;
    if (t.bountyUsdc >= 1 && t.bountyUsdc <= 25) s += 10;
    return s;
  };

  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

// R13, THE DAILY MISSION. Oscar's ruling 2026-09-20: "Make the first screen a
// rotating daily mission and completed proof-image strip; creation stays
// secondary." So the front door leads with ONE favour rather than with a list,
// and that favour is chosen by a rule instead of by whatever ranked first.
//
// WHY THIS IS NOT pickStarterFavour. That selector optimises for the EASIEST
// favour: text-friendly, remote, non-photo, a question you can answer with your
// thumb. Measured against the live board on 2026-09-20 it chose "What's the last
// thing that made you laugh out loud today?" while the signature favour, OpenClaw's
// "An AI can read everything ever written and still cannot answer this: what does
// today smell like where you are?", sat buried below the fold. Easiest and most
// distinctive are different questions, and the front door asks the second one.
//
// THE RULE, in order of weight:
//   1. SENSORY. A favour a model cannot answer from a corpus, because it needs a
//      body in a place: smell, taste, sound, touch, temperature. This is the whole
//      promise of a verified-human board, so it outranks everything else.
//   2. HERE AND NOW. "where you are", "near you", "right now" — a favour that is
//      about the answerer's own position in the world at this moment.
//   3. Reachable by anyone: remote/Anywhere location, so nobody is locked out by
//      geography, and a points band that reads as worth the trip.
//   4. Agent-posted, which is how the supply is authored (see AGENT-DOOR.md).
//      Oscar 2026-09-20: "Supply the great favours ourselves".
//
// ROTATION, and what it honestly is. Candidates are scored, the top-scoring group
// is taken, and the day chooses inside that group by a date hash. So the mission is
// stable for a whole UTC day, changes as the group changes, and is the SAME favour
// for everyone on earth on that date, which is what makes a shared daily moment
// possible. When one favour is the unique top scorer it holds the slot until the
// supply changes. That is a property of the supply, not a rotation failure, and the
// fix is to author more signature favours rather than to weaken the rule.
//
// It can return null. An empty first screen is honest when the board has nothing
// signature open; the caller falls back to the ordinary board.
// Deliberately narrow. An earlier draft included "loud", which matched "laugh out
// loud" and scored a generic question as a sensory one. A selector that matches the
// wrong thing generously is worse than one that matches nothing.
const SENSORY_RE = /\bsmell|\bscent|\btaste|\bsound|\bhear\b|\btouch|\btexture|\btemperature|\bwarm\b|\bcold\b/;
const HERE_NOW_RE = /where you are|near you|right now|around you|outside your|nearest/;

// ELIGIBILITY IS A PREDICATE, NOT A SCORE THRESHOLD, and the first draft got this
// wrong in a way worth keeping written down. With a numeric bar, remote plus
// agent-posted plus a fair points value summed to 30 and cleared it, and that
// combination describes every filler favour the replenisher used to post. So the
// traits that make a favour REACHABLE were letting it in, while the traits that make
// it WORTH LEADING WITH were optional. A mission must be sensory or about the
// answerer's own here and now. Nothing else qualifies, and when nothing qualifies the
// screen leads with the plain board and the repair is to author better supply.
export function isMissionCandidate(t: Task): boolean {
  const desc = t.description.toLowerCase();
  return SENSORY_RE.test(desc) || HERE_NOW_RE.test(desc);
}

export function dailyMissionScore(t: Task): number {
  const desc = t.description.toLowerCase();
  let s = 0;
  if (SENSORY_RE.test(desc)) s += 50;
  if (HERE_NOW_RE.test(desc)) s += 25;
  if (isRemoteLocation(t.location)) s += 15;
  if (t.poster.startsWith("agent")) s += 10;
  if (t.bountyUsdc >= 5 && t.bountyUsdc <= 25) s += 5;
  return s;
}

// Stable 32-bit hash of the UTC date string, so the pick inside the top group is
// deterministic per day and identical on the server and every client.
function dateHash(date: string): number {
  let h = 0;
  for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) >>> 0;
  return h;
}

export function pickDailyMission(
  tasks: Task[],
  date: string,
  userId: string | null,
  now = Date.now(),
): Task | null {
  const candidates = tasks.filter(
    (t) =>
      isBoardVisible(t, userId, now) &&
      t.status === "open" &&
      t.poster !== userId &&
      // Not `t.claimant !== userId`: an OPEN favour has a null claimant, so that
      // form excludes every candidate for a signed-out caller (null !== null is
      // false). Caught by running the selector against the real board with no
      // user, where it returned null for every date.
      !(userId && t.claimant === userId) &&
      t.rewardType === "points" &&
      t.bountyUsdc > 0 &&
      isMissionCandidate(t) &&
      !looksLikeSpam(t.description),
  );
  if (candidates.length === 0) return null;

  const best = Math.max(...candidates.map(dailyMissionScore));
  // Sorted by id so the top group has one canonical order regardless of the
  // order the board arrived in. Without this the "same favour for everyone"
  // property quietly depends on API response ordering.
  const top = candidates.filter((t) => dailyMissionScore(t) === best).sort((a, b) => a.id.localeCompare(b.id));
  return top[dateHash(date) % top.length];
}

// The proof strip beside the mission. REAL completed favours only, and only ones
// that carry a real proof image, because the point of the strip is that these
// photographs were taken by people. Preview and test identities are excluded the
// same way isPublicTask excludes them from the board: a `dev_` proof on the front
// screen would be fabricated evidence of use.
export const PROOF_STRIP_MAX = 8;
const NON_HUMAN_PREFIX = /^(dev_|demo_|e2e_)/;

export function pickProofStrip(tasks: Task[], max = PROOF_STRIP_MAX): Task[] {
  return tasks
    .filter(
      (t) =>
        t.status === "completed" &&
        !!t.proofImageUrl &&
        !NON_HUMAN_PREFIX.test(t.poster) &&
        !(t.claimant && NON_HUMAN_PREFIX.test(t.claimant)),
    )
    .sort((a, b) => new Date(b.deadline).getTime() - new Date(a.deadline).getTime())
    .slice(0, max);
}

// R16, THE FIRST FAVOUR CARD (2026-09-25). The first card of the favour list must
// be one this viewer can actually do: open, not their own post, not already
// delivered by them, and not a money pitch. A claim of their own also qualifies,
// because it is work in progress. If the ranked first card fails, the first card
// that passes moves to the front and everything else keeps its order. Nothing is
// dropped. When no card passes, the order is left alone.
export function canLeadFavour(t: Task, userId: string | null, completedIds: Set<string> = new Set()): boolean {
  if (isHidden(t) || looksLikeSpam(t.description)) return false;
  if (t.status === "claimed") return !!userId && t.claimant === userId;
  if (t.status !== "open") return false;
  if (userId && t.poster === userId) return false;
  if (completedIds.has(t.id)) return false;
  return (t.completionCount ?? 0) < Math.max(1, t.maxCompletions ?? 1);
}

export function leadWithDoable(tasks: Task[], userId: string | null, completedIds: Set<string> = new Set()): Task[] {
  if (tasks.length === 0 || canLeadFavour(tasks[0], userId, completedIds)) return tasks;
  const i = tasks.findIndex((t) => canLeadFavour(t, userId, completedIds));
  if (i > 0) return [tasks[i], ...tasks.slice(0, i), ...tasks.slice(i + 1)];
  // Nothing on the board is doable by this viewer (for example, only their own
  // posts). A money pitch still never leads: it goes to the end, order kept.
  const clean = tasks.filter((t) => !looksLikeSpam(t.description));
  return clean.concat(tasks.filter((t) => looksLikeSpam(t.description)));
}
