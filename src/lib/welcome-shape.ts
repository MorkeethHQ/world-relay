// THE WELCOME JOURNEY, the pure part (2026-10-05). Safe to import from a client
// component. The store logic is in welcome-journey.ts.
//
// WHAT WAS MEASURED. Public GET /api/tasks on production, 5 Oct 2026: 13 rows
// carry campaignId "first-favour". 8 of them are the original Welcome favours
// (posted 5 Jul 2026, 1000 replies each) and every one of the 8 is "claimed"
// with a flagged photo proof from one earlier person. A shared row holds one
// proof at a time, so no new person could do any Welcome favour. The campaign
// was not deleted. It was held.
//
// WHAT THIS DOES. A Welcome step is done on a per-person instance: a private
// copy of the source row, bound to it by welcomeSourceId and to one wallet by
// welcomeFor. One person's pending or flagged proof sits on their own instance
// and cannot take the step from anyone else. The 8 source rows are not reopened,
// edited or deleted; the earlier claims stay exactly as they are.
import type { Task } from "./types";
import { getCampaign, isCampaignRunning, type Campaign } from "./campaigns";
import { isFunded, isRealMoney } from "./reward";

export const WELCOME_CAMPAIGN_ID = "first-favour";

// Where the Welcome content comes from. Nothing here is new writing.
export const WELCOME_PROVENANCE = {
  campaignId: WELCOME_CAMPAIGN_ID,
  // git 0624dfc, 4 Jul 2026: "First Favour welcome campaign". It was a funded
  // USDC version for a few minutes. git aa027ee, the same night, made it the
  // points journey it has been since. The funded version is history and is not
  // offered again.
  firstCommit: "0624dfc",
  pointsVersionCommit: "aa027ee",
  createdOn: "2026-07-04",
  // The 10 task texts, as posted to production on 5 Jul 2026.
  taskTextSource: "scripts/first-favour.json",
  postedOn: "2026-07-05",
} as const;

// The 10 original Welcome favours, word for word from scripts/first-favour.json
// (a test compares the two). A row is a Welcome source only if its text is one
// of these, so a per-person instance can only ever be a copy of original
// Welcome material.
export const WELCOME_ORIGINAL_STEPS: readonly string[] = [
  "Photo your first drink of the day (coffee, tea, water, anything) and tell us which city you're in. Your first taste of FAVOUR.",
  "Show us the view from exactly where you're standing right now. One photo, and one line about your spot.",
  "Review the last meal you ate. Photo the food, rate it 1-10, and give one honest sentence about it.",
  "Photo something that could only be YOUR city, a street sign, a snack, a corner, and tell us what makes it local.",
  "Do one small favour for someone today with no reward: hold a door, give directions, help a neighbour. Tell us what you did and how it felt.",
  "Photo the price of a coffee or a bottle of water where you are, with the price visible. Real prices from real places.",
  "What's one thing that made you smile today? Show us with a single photo and one sentence.",
  "Show us where you're reading this from, your desk, your commute, your street. One honest photo, one line.",
  "Rate FAVOUR out of 10 after your first few favours. What was fun, what was confusing, what would you change?",
  "What favour would you love a verified human nearby to do for you? Describe it in a sentence. The best asks become real tasks on the board.",
];

// The Welcome campaign, only while it runs, and only while it is a points
// campaign with no cash unlock. A per-person instance must never reach the
// unlock path (campaign-unlock.ts pays USDC), so a campaign that carries an
// unlock is refused here and no instance can be made for it.
export function welcomeCampaign(now: number = Date.now()): Campaign | null {
  const c = getCampaign(WELCOME_CAMPAIGN_ID);
  if (!c || !isCampaignRunning(c, now)) return null;
  if (c.unlock || c.rewardKind !== "points" || c.totalBudget !== 0) return null;
  return c;
}

// A SOURCE ROW: one of the original Welcome favours, as a house agent posted it.
// Open or claimed (held) only. An expired, cancelled or completed row was closed
// by something else and this module does not bring it back. A row a person
// posted into the campaign is not a source, and neither is anything with money
// on it.
export function isWelcomeSourceRow(t: Task, now: number = Date.now()): boolean {
  return (
    t.campaignId === WELCOME_CAMPAIGN_ID &&
    !t.welcomeFor &&
    !t.welcomeSourceId &&
    !t.companyCampaignId &&
    !t.hiddenAt &&
    typeof t.poster === "string" && t.poster.startsWith("agent:") &&
    t.rewardType === "points" &&
    !isRealMoney(t) &&
    !isFunded(t) &&
    t.donOnChainId == null &&
    !t.escrowV2Address &&
    (t.maxCompletions ?? 1) > 1 &&
    (t.status === "open" || t.status === "claimed") &&
    new Date(t.deadline).getTime() > now &&
    WELCOME_ORIGINAL_STEPS.includes(t.description) &&
    welcomeCampaign(now) !== null
  );
}

// The source rows in the order the journey was written.
export function welcomeSources(tasks: Task[], now: number = Date.now()): Task[] {
  const seen = new Set<string>();
  return tasks
    .filter((t) => isWelcomeSourceRow(t, now))
    .sort((a, b) =>
      WELCOME_ORIGINAL_STEPS.indexOf(a.description) - WELCOME_ORIGINAL_STEPS.indexOf(b.description) ||
      a.createdAt.localeCompare(b.createdAt))
    // One step per original text: the oldest row wins if a text was posted twice.
    .filter((t) => (seen.has(t.description) ? false : (seen.add(t.description), true)));
}

// What one person sees for one step.
//   todo        nothing sent yet, or a rejected or declined proof was cleared
//   sent        a proof is saved and no check has scored it (the check did not run)
//   in_review   the automatic check flagged it; qualified reviewers decide
//   done        accepted, points credited
export type WelcomeStepState = "todo" | "sent" | "in_review" | "done";

export function welcomeStepState(instance: Task | null | undefined, completedSource: boolean): WelcomeStepState {
  if (completedSource || instance?.status === "completed") return "done";
  if (!instance || instance.status !== "claimed") return "todo";
  if (instance.verificationResult?.verdict === "flag") return "in_review";
  return "sent";
}

export type WelcomeStepView = {
  sourceTaskId: string;
  description: string;
  category: Task["category"];
  points: number;
  state: WelcomeStepState;
  // True when the caller is the earlier person whose proof sits on the shared
  // source row itself. They keep that claim; they get no second copy.
  onSharedRow?: boolean;
  // Present once the caller has started the step.
  instanceId?: string;
  proofNote?: string | null;
  hasPhoto?: boolean;
  // The last human review that did not accept the proof, if any.
  reviewNote?: { outcome: "upheld"; at: string; reasons: string[] } | null;
};

export type WelcomeView = {
  campaign: Pick<Campaign, "id" | "name" | "tagline" | "description" | "heroImage" | "endsAt" | "rewardPerTask">;
  provenance: typeof WELCOME_PROVENANCE;
  authenticated: boolean;
  steps: WelcomeStepView[];
  done: number;
};

// The next step this person can act on: the first one not done and not waiting.
export function nextWelcomeStep(steps: WelcomeStepView[]): WelcomeStepView | null {
  return steps.find((s) => s.state === "todo") ?? steps.find((s) => s.state === "sent") ?? null;
}

export function welcomeFinished(steps: WelcomeStepView[]): boolean {
  return steps.length > 0 && steps.every((s) => s.state === "done");
}
