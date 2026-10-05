import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { Task } from "@/lib/types";
import { CAMPAIGNS, getCampaign, getCampaigns } from "@/lib/campaigns";
import { WELCOME_CAMPAIGN_ID, WELCOME_ORIGINAL_STEPS, WELCOME_PROVENANCE, isWelcomeSourceRow, welcomeCampaign, welcomeSources, welcomeStepState, nextWelcomeStep, type WelcomeStepView, type WelcomeView } from "@/lib/welcome-shape";
import { pickCampaignStage } from "@/lib/campaign-stage";
import { DEMO_BRAND, formatProposedUsdc, proposedLabel } from "@/lib/demo-brand";
import { splitPolls, pollSummary } from "@/lib/poll-view";
import { reviewPathFor } from "@/lib/review-path";
import { reviewEntryFor } from "@/lib/review-entry";
import { isAppealable } from "@/lib/jury-appeal";
import { houseReviewScope } from "@/lib/house-review-gate";
const isWelcomeReviewable = (t: Task, now?: number) => houseReviewScope(t, now) === "welcome_instance";
import { isBoardVisible } from "@/lib/board-rank";
import { isTestFixture, fixtureStoreOrigin, fixtureVerdict, FixtureCheckDown } from "@/lib/test-fixture";
import type { PublicCompanyCampaign } from "@/lib/campaign-draft-shape";

// CAMPAIGN FIRST (2026-10-05). The pure rules behind R19, the Welcome journey,
// the demo brand, the polls page, the review copy and the local fixture switch.
const NOW = Date.parse("2026-10-05T12:00:00Z");
const root = join(__dirname, "..", "..");

function row(over: Partial<Task> = {}): Task {
  return {
    id: "src-1", poster: "agent:relay", claimant: null, category: "photo", campaignId: WELCOME_CAMPAIGN_ID,
    description: WELCOME_ORIGINAL_STEPS[0], location: "Anywhere", lat: null, lng: null, bountyUsdc: 5,
    deadline: "2027-07-05T00:00:00.000Z", status: "open", proofImageUrl: null, proofImages: null, proofNote: null,
    verificationResult: null, attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null, callbackUrl: null,
    onChainId: null, escrowTxHash: null, claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null,
    donStakeTxHash: null, claimantVerification: null, requiresClaim: false, pendingRelease: false, maxCompletions: 1000,
    completionCount: 0, createdAt: "2026-07-05T10:00:00.000Z", ...over,
  };
}

describe("the Welcome content is the original, with its id and dates", () => {
  it("the ten step texts are scripts/first-favour.json word for word, in order", () => {
    const posted = JSON.parse(readFileSync(join(root, "scripts", "first-favour.json"), "utf8")).tasks as Array<{ description: string; campaignId: string; rewardType: string }>;
    expect(posted.map((t) => t.description)).toEqual([...WELCOME_ORIGINAL_STEPS]);
    expect(posted.every((t) => t.campaignId === WELCOME_CAMPAIGN_ID && t.rewardType === "points")).toBe(true);
  });

  it("the campaign keeps its id, its end date and its points-only shape", () => {
    const c = getCampaign(WELCOME_CAMPAIGN_ID)!;
    expect(c.id).toBe("first-favour");
    expect(c.endsAt).toBe("2026-12-31T23:59:59Z");
    expect(c.rewardKind).toBe("points");
    expect(c.totalBudget).toBe(0);
    expect(c.unlock).toBeUndefined();
    expect(WELCOME_PROVENANCE.createdOn).toBe("2026-07-04");
    expect(welcomeCampaign(NOW)?.id).toBe("first-favour");
  });

  it("it stops being offered at its end date, and is refused outright if it ever carries a cash unlock", () => {
    expect(welcomeCampaign(Date.parse("2027-01-01T00:00:00Z"))).toBeNull();
    const c = CAMPAIGNS.find((x) => x.id === WELCOME_CAMPAIGN_ID)!;
    const saved = c.unlock;
    try {
      c.unlock = { pot: 10, unlockThreshold: 1, unlockAmount: 2, requiresOrb: true, maxCountedPerUser: 1 };
      expect(welcomeCampaign(NOW)).toBeNull();
      expect(isWelcomeSourceRow(row(), NOW)).toBe(false);
    } finally { c.unlock = saved; }
  });

  it("no ended funded campaign is ever the Welcome campaign", () => {
    for (const c of getCampaigns().filter((x) => x.unlock || x.rewardKind === "usdc")) expect(c.id).not.toBe(WELCOME_CAMPAIGN_ID);
  });
});

describe("what counts as a Welcome source row", () => {
  it("an original favour, open or held", () => {
    expect(isWelcomeSourceRow(row(), NOW)).toBe(true);
    expect(isWelcomeSourceRow(row({ status: "claimed", claimant: "0xabc" }), NOW)).toBe(true);
  });
  it.each([
    ["a row a person posted into the campaign", { poster: "0x7e57da7a000000000000000000000000000000a1" }],
    ["text that is not original Welcome text", { description: "Something else entirely" }],
    ["a single-reply row", { maxCompletions: 1 }],
    ["an expired row", { status: "expired" as const }],
    ["a completed row", { status: "completed" as const }],
    ["a row past its deadline", { deadline: "2026-01-01T00:00:00.000Z" }],
    ["a USDC row", { rewardType: "usdc" as const }],
    ["a row with an on-chain id", { onChainId: 4 }],
    ["a row with an escrow hash", { escrowTxHash: "funded" }],
    ["a Double or Nothing row", { donOnChainId: 2 }],
    ["an escrow-v2 row", { escrowV2Address: `0x${"e".repeat(40)}` }],
    ["a company piece", { companyCampaignId: "draft_x" }],
    ["a hidden row", { hiddenAt: "2026-10-01T00:00:00Z" }],
    ["a per-person instance", { welcomeFor: "0xabc", welcomeSourceId: "src-0" }],
    ["another campaign's row", { campaignId: "comeback-2026" }],
  ])("refuses %s", (_name, over) => {
    expect(isWelcomeSourceRow(row(over as Partial<Task>), NOW)).toBe(false);
  });
  it("orders the steps as the journey was written, one per text", () => {
    const rows = [row({ id: "c", description: WELCOME_ORIGINAL_STEPS[2] }), row({ id: "a" }), row({ id: "a2", createdAt: "2026-07-06T00:00:00.000Z" }), row({ id: "b", description: WELCOME_ORIGINAL_STEPS[1] })];
    expect(welcomeSources(rows, NOW).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
  it("R19: an open source row is not a board card", () => {
    expect(isBoardVisible(row(), null, NOW)).toBe(false);
    // The same favour with other text is an ordinary campaign favour and shows.
    expect(isBoardVisible(row({ description: "Photo your first drink of the day and tell us your city" }), null, NOW)).toBe(true);
  });
});

describe("one person's step state", () => {
  it("reads todo, sent, in review and done", () => {
    expect(welcomeStepState(null, false)).toBe("todo");
    expect(welcomeStepState(row({ status: "open" }), false)).toBe("todo");
    expect(welcomeStepState(row({ status: "claimed" }), false)).toBe("sent");
    expect(welcomeStepState(row({ status: "claimed", verificationResult: { verdict: "flag", reasoning: "", confidence: 0.5 } }), false)).toBe("in_review");
    expect(welcomeStepState(row({ status: "completed" }), false)).toBe("done");
    expect(welcomeStepState(null, true)).toBe("done");
  });
  it("a step in review does not block the next one", () => {
    const steps = [{ state: "in_review" }, { state: "todo", sourceTaskId: "b" }] as WelcomeStepView[];
    expect(nextWelcomeStep(steps)?.sourceTaskId).toBe("b");
  });
});

describe("R19, the campaign stage", () => {
  const step = (state: WelcomeStepView["state"], id: string): WelcomeStepView => ({ sourceTaskId: id, description: "d", category: "photo", points: 5, state });
  const view = (states: WelcomeStepView["state"][]): WelcomeView => ({
    campaign: { id: "first-favour", name: "Your First Favours", tagline: "", description: "", heroImage: "/hero/coffee.jpg", endsAt: "2026-12-31T23:59:59Z", rewardPerTask: 10 },
    provenance: WELCOME_PROVENANCE, authenticated: true, steps: states.map((s, i) => step(s, `s${i}`)), done: states.filter((s) => s === "done").length,
  });
  const company = { campaign: { id: "draft_1", company: "Checked Co" } as PublicCompanyCampaign, openPieces: 2, totalOpen: 2 };

  it("Welcome is current while a step is left to do", () => {
    const s = pickCampaignStage({ welcome: view(["done", "in_review", "todo"]), company });
    expect(s.current).toBe("welcome");
    expect(s.welcome).toMatchObject({ total: 3, done: 1, waiting: 1, finished: false });
    expect(s.welcome!.next!.sourceTaskId).toBe("s2");
  });
  it("then a real company campaign, when one may lead", () => {
    expect(pickCampaignStage({ welcome: view(["done", "done"]), company }).current).toBe("company");
    expect(pickCampaignStage({ welcome: null, company }).current).toBe("company");
  });
  it("the demo brand is never something to join: it is current only as a preview, and carries no campaign to open", () => {
    const s = pickCampaignStage({ welcome: view(["done"]), company: null });
    expect(s.current).toBe("demo");
    expect(s.company).toBeNull();
    expect(s.demo.claimable).toBe(false);
  });
  it("Welcome waiting on a check, with no company open, stays on Welcome", () => {
    expect(pickCampaignStage({ welcome: view(["done", "in_review"]), company: null }).current).toBe("welcome");
  });
});

describe("the demo brand is a picture, not a campaign", () => {
  it("is not in CAMPAIGNS and cannot be resolved or linked to a task", () => {
    expect(getCampaigns().some((c) => c.id === DEMO_BRAND.id || c.name === DEMO_BRAND.name || c.brand === DEMO_BRAND.name)).toBe(false);
    expect(getCampaign(DEMO_BRAND.id)).toBeNull();
  });
  it("is labelled a demo, not funded, not claimable, and says the brand does not exist", () => {
    expect(DEMO_BRAND.demo).toBe(true);
    expect(DEMO_BRAND.funded).toBe(false);
    expect(DEMO_BRAND.claimable).toBe(false);
    expect(DEMO_BRAND.label).toMatch(/Demo/);
    expect(DEMO_BRAND.disclaimer).toMatch(/does not exist/);
    expect(DEMO_BRAND.disclaimer).toMatch(/pays USDC or points/);
  });
  it("has micro favours and one big challenge, and no field that could be read as money owed", () => {
    expect(DEMO_BRAND.items.filter((i) => i.size === "micro").length).toBeGreaterThanOrEqual(3);
    expect(DEMO_BRAND.items.filter((i) => i.size === "big").length).toBe(1);
    for (const i of DEMO_BRAND.items) expect(Object.keys(i).sort()).toEqual(["ask", "effort", "key", "proposedUsdc", "size", "title"]);
    expect(JSON.stringify(DEMO_BRAND)).not.toMatch(/bountyUsdc|rewardType|onChainId|escrow|unlock|pot"/);
  });
  it("0.001 USDC is written 0.001, never 0.00", () => {
    expect(formatProposedUsdc(0.001)).toBe("0.001");
    expect(formatProposedUsdc(0.001)).not.toBe((0.001).toFixed(2));
    expect(formatProposedUsdc(25)).toBe("25");
    expect(formatProposedUsdc(0.5)).toBe("0.5");
    expect(formatProposedUsdc(0.000001)).toBe("0.000001");
    expect(formatProposedUsdc(200)).toBe("200");
    expect(proposedLabel(0.001)).toBe("Proposed 0.001 USDC, not funded");
  });
  it("the screens print the amount through that one function and say it cannot be started", () => {
    const ui = readFileSync(join(root, "src", "components", "CampaignFrontDoor.tsx"), "utf8");
    expect(ui).not.toMatch(/proposedUsdc\.toFixed|\$\{it\.proposedUsdc\}|>\{it\.proposedUsdc\}/);
    expect(ui).toMatch(/formatProposedUsdc\(it\.proposedUsdc\)/);
    expect(ui).toMatch(/Demo · fictional brand/);
    expect(ui).toMatch(/It cannot be started, it takes no proof, and it pays nothing/);
    // No button on the demo screens submits, claims or posts anything.
    expect(ui).not.toMatch(/fetch\(/);
  });
});

describe("polls lead with what is open", () => {
  const p = (id: string, endsInH: number, votes = 0, youVoted = false, createdH = 1) => ({ id, endsAt: new Date(NOW + endsInH * 3600_000).toISOString(), createdAt: new Date(NOW - createdH * 3600_000).toISOString(), totalVotes: votes, youVoted });
  it("open first with unanswered questions leading, closed after, newest closed first", () => {
    const { open, closed } = splitPolls([p("old", -100), p("voted", 10, 9, true), p("fresh", 10, 0), p("busy", 10, 4), p("recent", -2)], NOW);
    expect(open.map((x) => x.id)).toEqual(["busy", "fresh", "voted"]);
    expect(closed.map((x) => x.id)).toEqual(["recent", "old"]);
  });
  it("invents nothing: every poll in is a poll out, with its own vote count", () => {
    const input = [p("a", 5, 0), p("b", -5, 3)];
    const { open, closed } = splitPolls(input, NOW);
    expect([...open, ...closed].sort((x, y) => x.id.localeCompare(y.id))).toEqual(input);
    expect(splitPolls([], NOW)).toEqual({ open: [], closed: [] });
  });
  it("the summary is counts only", () => {
    expect(pollSummary([p("a", 5), p("b", 5, 1, true)], [])).toBe("1 open question for you.");
    expect(pollSummary([p("b", 5, 1, true)], [])).toBe("You have answered all 1 open poll.");
    expect(pollSummary([], [p("c", -5)])).toBe("No open poll right now. 1 closed.");
    expect(pollSummary([], [])).toBe("No polls yet.");
  });
  it("the page shows open polls by default, closed ones behind a control, and a create action when none is open", () => {
    const ui = readFileSync(join(root, "src", "components", "Polls.tsx"), "utf8");
    expect(ui).toMatch(/useState\(false\);\n\n  const fetchPolls/);
    expect(ui).toMatch(/\{showClosed && ended\.map/);
    expect(ui).toMatch(/No open poll right now/);
    expect(ui).toMatch(/createButton\(true\)/);
    const predictions = readFileSync(join(root, "src", "components", "Predictions.tsx"), "utf8");
    expect(predictions).toMatch(/\{showPast && done\.slice\(0, pastShown\)/);
  });
});

describe("the proof screen only promises a review that exists for this proof", () => {
  const flagged = (over: Partial<Task>): Task => row({ id: "t", campaignId: undefined, status: "claimed", claimant: "0x7e57da7a000000000000000000000000000000a1", proofSubmissionId: "p1", proofNote: "a note", verificationResult: { verdict: "flag", reasoning: "r", confidence: 0.5 }, ...over });

  it("a per-person Welcome instance: human review, photo or written", () => {
    const inst = flagged({ campaignId: WELCOME_CAMPAIGN_ID, welcomeFor: "0x7e57da7a000000000000000000000000000000a1", welcomeSourceId: "src-1", maxCompletions: 1 });
    for (const photo of [true, false]) {
      const path = reviewPathFor(inst, photo);
      expect(path.kind).toBe("welcome_jury");
      expect(path.humanReview).toBe(true);
    }
    // and the server gate agrees, for a written proof too
    expect(isWelcomeReviewable(inst, NOW)).toBe(true);
    expect(isWelcomeReviewable({ ...inst, proofImageUrl: "https://x/y.jpg", proofNote: null }, NOW)).toBe(true);
  });
  it("a house favour with a photo: the jury appeal, and the server gate agrees", () => {
    const t = flagged({ proofImageUrl: "https://x/y.jpg" });
    expect(reviewPathFor(t, true).kind).toBe("photo_jury");
    expect(isAppealable(t)).toBe(true);
  });
  it("a house favour with a WRITTEN answer: qualified reviewers, through the house gate and not the frozen photo appeal", () => {
    const t = flagged({});
    const path = reviewPathFor(t, false);
    expect(path.kind).toBe("house_jury");
    expect(path.humanReview).toBe(true);
    expect(houseReviewScope(t, NOW)).toBe("house_text");
    // The frozen gate still refuses it. Nothing was widened there.
    expect(isAppealable(t)).toBe(false);
  });
  it("one proof, one path: a plain photo stays with the photo appeal and is not also a house case", () => {
    const t = flagged({ proofImageUrl: "https://x/y.jpg" });
    expect(isAppealable(t)).toBe(true);
    expect(houseReviewScope(t, NOW)).toBeNull();
  });
  it("an original Welcome claim still held on the shared row: reviewers, and the server gate agrees", () => {
    const held = flagged({ campaignId: WELCOME_CAMPAIGN_ID, proofImageUrl: "https://x/y.jpg" });
    expect(houseReviewScope(held, NOW)).toBe("welcome_source");
    expect(reviewPathFor(held, true).kind).toBe("welcome_jury");
  });
  it("a cash unlock campaign is refused even when the favour carries original Welcome text", () => {
    // The first version of this check passed with the campaign line removed,
    // because the text line behind it caught the same rows. This row has the
    // original text, so only the campaign line can refuse it.
    for (const campaignId of ["comeback-2026", "say-it-out-loud", "ask-for-it"]) {
      expect(houseReviewScope(flagged({ campaignId, description: WELCOME_ORIGINAL_STEPS[0], maxCompletions: 1000 }), NOW)).toBeNull();
    }
    // And Welcome itself is refused once it has ended.
    expect(houseReviewScope(flagged({ campaignId: WELCOME_CAMPAIGN_ID, description: WELCOME_ORIGINAL_STEPS[0], maxCompletions: 1000 }), Date.parse("2027-01-02T00:00:00Z"))).toBeNull();
  });
  it.each([
    ["a favour a person posted", { poster: "0x7e57da7a000000000000000000000000000000d1" }],
    ["another campaign", { campaignId: "ask-for-it" }],
    ["a campaign with a cash unlock", { campaignId: "comeback-2026" }],
    ["a company piece", { companyCampaignId: "draft_1" }],
    ["a hidden favour", { hiddenAt: "2026-10-01T00:00:00Z" }],
    ["Welcome text that is not original", { campaignId: WELCOME_CAMPAIGN_ID, description: "not an original text" }],
    ["USDC", { rewardType: "usdc" as const }],
    ["an escrow hash", { escrowTxHash: "funded" }],
    ["an on-chain id", { onChainId: 9 }],
    ["Double or Nothing", { taskType: "double-or-nothing" as const }],
    ["a Double or Nothing id", { donOnChainId: 1 }],
    ["escrow-v2", { escrowV2Address: `0x${"e".repeat(40)}` }],
    ["a proof that passed", { verificationResult: { verdict: "pass" as const, reasoning: "", confidence: 1 } }],
    ["a favour no longer claimed", { status: "open" as const }],
    ["a sender that is not a wallet", { claimant: "dev_1a2b3c4d" }],
  ])("the house gate refuses %s", (_n, over) => {
    expect(houseReviewScope(flagged(over as Partial<Task>), NOW)).toBeNull();
  });
  it("a favour a person posted: that person decides", () => {
    expect(reviewPathFor(flagged({ poster: "0x7e57da7a000000000000000000000000000000d1" }), false).kind).toBe("poster");
  });
  it("a shared campaign favour that is not an instance: no human review", () => {
    const t = flagged({ campaignId: "ask-for-it", proofImageUrl: "https://x/y.jpg" });
    expect(reviewPathFor(t, true).humanReview).toBe(false);
    expect(isAppealable(t)).toBe(false);
  });
  it("a company piece: reviewers only under the jury rule and only for a photo", () => {
    const t = flagged({ companyCampaignId: "draft_1", proofImageUrl: "https://x/y.jpg" });
    expect(reviewPathFor(t, true, "ai_and_jury").kind).toBe("company_jury");
    expect(reviewPathFor(t, false, "ai_and_jury").humanReview).toBe(false);
    expect(reviewPathFor(t, true, "ai").humanReview).toBe(false);
  });
  it.each([
    ["USDC", { rewardType: "usdc" as const }],
    ["an on-chain id", { onChainId: 3 }],
    ["an escrow hash", { escrowTxHash: "funded" }],
    ["Double or Nothing", { donOnChainId: 1 }],
    ["escrow-v2", { rewardType: "usdc-v2" as const, escrowV2Address: `0x${"e".repeat(40)}` }],
  ])("money (%s) is never decided by a person, even on a Welcome instance", (_n, over) => {
    const t = flagged({ proofImageUrl: "https://x/y.jpg", welcomeFor: "0x7e57da7a000000000000000000000000000000a1", welcomeSourceId: "src-1", campaignId: WELCOME_CAMPAIGN_ID, ...(over as Partial<Task>) });
    const path = reviewPathFor(t, true);
    expect(path.kind).toBe("none_money");
    expect(path.humanReview).toBe(false);
    expect(isWelcomeReviewable(t, NOW)).toBe(false);
    expect(isAppealable(t)).toBe(false);
  });
  it("no branch uses the old promise", () => {
    const feed = readFileSync(join(root, "src", "components", "Feed.tsx"), "utf8");
    expect(feed).not.toMatch(/People check it by hand/);
    expect(feed).not.toMatch(/Waiting for a human check/);
    expect(feed).not.toMatch(/Under review\. You'll be notified/);
  });
});

describe("the Welcome review gate", () => {
  const inst = (over: Partial<Task> = {}): Task => row({ id: "i", status: "claimed", claimant: "0x7e57da7a000000000000000000000000000000a1", welcomeFor: "0x7e57da7a000000000000000000000000000000a1", welcomeSourceId: "src-1", maxCompletions: 1, proofSubmissionId: "p", proofNote: "answer", verificationResult: { verdict: "flag", reasoning: "r", confidence: 0.5 }, ...over });
  it("accepts a flagged instance", () => expect(isWelcomeReviewable(inst(), NOW)).toBe(true));
  it.each([
    ["a passed proof", { verificationResult: { verdict: "pass" as const, reasoning: "", confidence: 1 } }],
    ["an instance not yet claimed", { status: "open" as const }],
    ["a completed instance", { status: "completed" as const }],
    ["a shared row (no owner)", { welcomeFor: undefined, welcomeSourceId: undefined }],
    ["a claimant who is not the owner", { claimant: "0x7e57da7a000000000000000000000000000000b2" }],
    ["a proof with nothing to read", { proofNote: "  ", proofImageUrl: null }],
    ["another campaign", { campaignId: "comeback-2026" }],
    ["a company piece", { companyCampaignId: "draft_1" }],
  ])("refuses %s", (_n, over) => expect(isWelcomeReviewable(inst(over as Partial<Task>), NOW)).toBe(false));
  it("refuses everything once the campaign has ended", () => {
    expect(isWelcomeReviewable(inst(), Date.parse("2027-01-02T00:00:00Z"))).toBe(false);
  });
  it("the review file has no call that moves money or writes campaign progress", () => {
    const src = readFileSync(join(root, "src", "lib", "house-review.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/recordCampaignCompletion|releaseEscrow|campaign-unlock|recordCompletion\(|markSettled|sendPayout/);
    // The frozen photo-appeal gate is the same function it was, only moved.
    const rules = readFileSync(join(root, "src", "lib", "jury-appeal-rules.ts"), "utf8");
    expect(rules).toMatch(/!!t\.proofImageUrl &&[\s\S]*t\.rewardType === "points" &&[\s\S]*!isRealMoney\(t\) &&[\s\S]*!isFunded\(t\) &&[\s\S]*t\.donOnChainId === null &&\s*!t\.campaignId &&\s*!t\.escrowV2Address/);
  });
});

describe("the one Review favours entry", () => {
  it("uses real counts and says how to qualify", () => {
    const e = reviewEntryFor({ waiting: 3, flaggedWaiting: 2, record: { judged: 4, correct: 3 }, walletUser: true });
    expect(e.title).toBe("Review favours");
    expect(e.line).toMatch(/^3 real proofs to judge/);
    expect(e.flagged).toBe("2 flagged proofs wait for a human decision.");
    expect(e.qualification).toBe("4 of 10 graded calls, 75% right. 10 calls at 60% qualifies you to decide flagged proofs.");
  });
  it("prints no count when there is none", () => {
    const e = reviewEntryFor({ waiting: 0, flaggedWaiting: 0, record: null, walletUser: true });
    expect(e.flagged).toBeNull();
    expect(e.line).not.toMatch(/\d/);
  });
  it("tells a qualified reviewer, and a preview identity, the truth", () => {
    expect(reviewEntryFor({ waiting: 0, flaggedWaiting: 0, record: { judged: 12, correct: 10 }, walletUser: true }).qualification).toMatch(/Your decision counts/);
    expect(reviewEntryFor({ waiting: 0, flaggedWaiting: 0, record: { judged: 20, correct: 5 }, walletUser: true }).qualification).not.toMatch(/Your decision counts/);
    expect(reviewEntryFor({ waiting: 0, flaggedWaiting: 0, record: null, walletUser: false }).qualification).toMatch(/World App/);
  });
  it("is the only door to the deck on the board", () => {
    const feed = readFileSync(join(root, "src", "components", "Feed.tsx"), "utf8");
    const board = feed.slice(feed.indexOf("  return (\n    <div\n      ref={feedContainerRef}"), feed.indexOf("function ReviewEntryCard("));
    expect((board.match(/setView\("jury"\)/g) || []).length).toBe(1);
    expect((board.match(/<ReviewEntryCard/g) || []).length).toBe(1);
    expect(feed).not.toMatch(/REAL OR NOT — hidden on first visit/);
    expect(feed).not.toMatch(/function ReviewProofCard/);
  });
});

describe("the local fixture switch cannot be on in production", () => {
  it("needs the switch AND a non-production build", () => {
    expect(isTestFixture({ FAVOUR_TEST_FIXTURE: "1", NODE_ENV: "development" })).toBe(true);
    expect(isTestFixture({ FAVOUR_TEST_FIXTURE: "1", NODE_ENV: "production" })).toBe(false);
    expect(isTestFixture({ NODE_ENV: "development" })).toBe(false);
    expect(isTestFixture({ FAVOUR_TEST_FIXTURE: "true", NODE_ENV: "development" })).toBe(false);
  });
  it("the sign-in helper is passed through only to a store on 127.0.0.1", () => {
    const on = { FAVOUR_TEST_FIXTURE: "1", NODE_ENV: "development" };
    expect(fixtureStoreOrigin({ ...on, KV_REST_API_URL: "http://127.0.0.1:8079" })).toBe("http://127.0.0.1:8079");
    expect(fixtureStoreOrigin({ ...on, KV_REST_API_URL: "https://real-store.upstash.io" })).toBeNull();
    expect(fixtureStoreOrigin({ ...on, KV_REST_API_URL: "http://127.0.0.1:8079.evil.example" })).toBeNull();
    expect(fixtureStoreOrigin({ ...on, KV_REST_API_URL: "http://localhost:8079" })).toBeNull();
    expect(fixtureStoreOrigin({ FAVOUR_TEST_FIXTURE: "1", NODE_ENV: "production", KV_REST_API_URL: "http://127.0.0.1:8079" })).toBeNull();
  });
  it("the stand-in check does what the note asks and never guesses", () => {
    expect(fixtureVerdict("my tea").verdict).toBe("pass");
    expect(fixtureVerdict("TEST FLAG tea").verdict).toBe("flag");
    expect(fixtureVerdict("test fail").verdict).toBe("fail");
    expect(() => fixtureVerdict("TEST DOWN")).toThrow(FixtureCheckDown);
    for (const n of ["x", "TEST FLAG", "TEST FAIL"]) expect(fixtureVerdict(n).reasoning).toMatch(/TEST DATA/);
  });
  it("the proof route reaches the stand-in only where the dev stub was already reached", () => {
    const route = readFileSync(join(root, "src", "app", "api", "verify-proof", "route.ts"), "utf8");
    expect((route.match(/devStandIn\(\)/g) || []).length).toBe(1);
    const at = route.indexOf("result = devStandIn();");
    const before = route.slice(route.lastIndexOf("if (taskIsFunded || process.env.NODE_ENV === \"production\")", at), at);
    expect(before).toMatch(/\} else \{\s*$/);
  });
});
