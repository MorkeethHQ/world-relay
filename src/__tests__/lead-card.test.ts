import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Task } from "@/lib/types";
import type { PublicCompanyCampaign } from "@/lib/campaign-draft-shape";
import { rankCampaignCards, canLeadCampaign, pickCampaignToDo } from "@/lib/company-door";
import { isBoardVisible, canLeadFavour, leadWithDoable, looksLikeSpam, orderBoardForApi, pickStarterFavour, pickDailyMission } from "@/lib/board-rank";
import { isPublicTask } from "@/lib/task-serializer";

// R16, WHAT MAY LEAD THE BOARD (2026-09-25). A stranger test found the first card a
// new visitor saw was "kcz sdn,bhd · just want to make money": an unverified company,
// a 5-word brief, no product, so no piece could be joined. These fixtures are the
// three campaigns production served on 2026-09-25 (GET /api/campaigns/company),
// copied field for field, plus one campaign that is allowed to lead.

const NOW = Date.parse("2026-09-25T12:00:00Z");

const LIVE: PublicCompanyCampaign[] = [
  {
    id: "draft_02e1e94c-fd35-4d27-bd8b-fa863838e3f8", company: "MDM Enterprise", brief: "Make short video about product",
    status: "published", companyChecked: false, productName: undefined, productUrl: undefined, publishedAt: "2026-09-22T05:05:13.180Z",
    pieceTaskIds: { ugc: "0e9c74d3", article: "e8bf9b8b", review: "26c9e2e1" },
    pieces: [{ kind: "ugc", count: 5 }, { kind: "article", count: 2 }, { kind: "review", count: 10 }],
    rewardPerPiecePoints: 10, proposedPoolUsdc: 200, reviewRule: "ai",
  },
  {
    id: "draft_230c7d35-56c2-4088-976c-91966e7ff8c9", company: "kcz sdn,bhd", brief: "just want to make money",
    status: "published", companyChecked: false, productName: undefined, productUrl: undefined, publishedAt: "2026-09-22T04:55:00.594Z",
    pieceTaskIds: { ugc: "06cb72ee", article: "0fb8fe50", review: "b25dcc8b" },
    pieces: [{ kind: "ugc", count: 4 }, { kind: "article", count: 2 }, { kind: "review", count: 10 }],
    rewardPerPiecePoints: 5, proposedPoolUsdc: 200, reviewRule: "ai",
  },
  {
    id: "draft_76481794-e040-4050-b8a4-30829e7b9e96", company: "Filipino Lokal",
    brief: "Honest content about Filipino local products and small businesses, made by real customers sharing their genuine experiences. Simple, natural, and suitable for UGC, articles, and honest reviews.",
    status: "published", companyChecked: false, productName: undefined, productUrl: undefined, publishedAt: "2026-09-21T17:05:13.000Z",
    pieceTaskIds: { ugc: "e80a8417", article: "a41f18d6", review: "1c1dd7a2" },
    pieces: [{ kind: "ugc", count: 5 }, { kind: "article", count: 5 }, { kind: "review", count: 10 }],
    rewardPerPiecePoints: 10, proposedPoolUsdc: 200, reviewRule: "ai",
  },
];

const GOOD: PublicCompanyCampaign = {
  ...LIVE[2], id: "draft_good", company: "Checked Co", companyChecked: true,
  productName: "Lokal Box", productUrl: "https://example.com/box", publishedAt: "2026-09-23T00:00:00.000Z",
  pieceTaskIds: { ugc: "good-u" },
};

let n = 0;
function task(o: Partial<Task> = {}): Task {
  n++;
  return {
    id: `t${n}`, poster: `0x${String(n).padStart(40, "0")}`, claimant: null, category: "feedback",
    description: `a real favour number ${n}`, location: "Anywhere", lat: null, lng: null, bountyUsdc: 10,
    deadline: "2026-10-05T00:00:00Z", status: "open", proofImageUrl: null, proofImages: null, proofNote: null,
    verificationResult: null, attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null, callbackUrl: null,
    onChainId: null, escrowTxHash: null, claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null,
    donStakeTxHash: null, requiresClaim: false, pendingRelease: false, maxCompletions: 100, completionCount: 0,
    createdAt: "2026-09-24T00:00:00Z", ...o,
  } as Task;
}
const pieceTasks = [...LIVE, GOOD].flatMap((c) => Object.values(c.pieceTaskIds ?? {}).map((id) => task({ id, companyCampaignId: c.id })));

describe("R16: campaigns that may lead the board", () => {
  it("none of the three live campaigns may lead: unverified, thin brief or no product", () => {
    for (const c of LIVE) expect(canLeadCampaign(c, pieceTasks)).toBe(false);
    const { lead, rest } = rankCampaignCards(LIVE, pieceTasks);
    expect(lead).toEqual([]);
    // Demoted below the favours, never dropped.
    expect(rest.map((c) => c.company).sort()).toEqual(["Filipino Lokal", "MDM Enterprise", "kcz sdn,bhd"]);
  });

  it("a checked company with a real brief, a product and an open piece leads", () => {
    const { lead, rest } = rankCampaignCards([...LIVE, GOOD], pieceTasks);
    expect(lead.map((c) => c.id)).toEqual([GOOD.id]);
    expect(rest).toHaveLength(3);
    expect(pickCampaignToDo([...LIVE, GOOD], pieceTasks)?.campaign.id).toBe(GOOD.id);
  });

  it("each failing condition alone keeps a campaign from leading", () => {
    expect(canLeadCampaign({ ...GOOD, companyChecked: false }, pieceTasks)).toBe(false);
    expect(canLeadCampaign({ ...GOOD, hidden: true }, pieceTasks)).toBe(false);
    expect(canLeadCampaign({ ...GOOD, brief: "just want to make money" }, pieceTasks)).toBe(false);
    expect(canLeadCampaign({ ...GOOD, productUrl: undefined }, pieceTasks)).toBe(false);
    // Nothing the viewer can do: the only piece is delivered by them, or full.
    expect(canLeadCampaign(GOOD, pieceTasks, new Set(["good-u"]))).toBe(false);
    expect(canLeadCampaign(GOOD, [task({ id: "good-u", maxCompletions: 5, completionCount: 5 })])).toBe(false);
    // A 20-word brief that is still a money pitch does not lead.
    const pitch = "We want you to make money fast with our program, post about it everywhere and tell your friends to join and earn with us today please.";
    expect(canLeadCampaign({ ...GOOD, brief: pitch }, pieceTasks)).toBe(false);
  });

  it("an operator-hidden campaign is not on the board at all, not even below", () => {
    const kcz = { ...LIVE[1], hidden: true };
    const { lead, rest } = rankCampaignCards([LIVE[0], kcz, LIVE[2]], pieceTasks);
    expect([...lead, ...rest].some((c) => c.id === kcz.id)).toBe(false);
    expect(rest).toHaveLength(2);
  });

  it("with the live supply, the signed-out first screen offers no campaign", () => {
    expect(pickCampaignToDo(LIVE, pieceTasks)).toBeNull();
  });
});

describe("R16: the first favour card is one the viewer can do", () => {
  it("spam text is recognised narrowly", () => {
    expect(looksLikeSpam("just want to make money")).toBe(true);
    expect(looksLikeSpam("Earn easy money from home")).toBe(true);
    expect(looksLikeSpam("What is the smallest thing that made your day better today?")).toBe(false);
    expect(looksLikeSpam("How much money did your lunch cost?")).toBe(false);
  });

  it("the viewer's own post, a full favour, a delivered one and a money pitch never lead", () => {
    const me = "0xme";
    const mine = task({ poster: me });
    const full = task({ maxCompletions: 3, completionCount: 3 });
    const done = task();
    const spam = task({ description: "just want to make money" });
    const good = task();
    const out = leadWithDoable([mine, full, done, spam, good], me, new Set([done.id]));
    expect(out[0].id).toBe(good.id);
    // Only the lead moves and the rest keep their order. The money pitch is left
    // out of the default list altogether.
    expect(out.map((t) => t.id)).toEqual([good, mine, full, done].map((t) => t.id));
  });

  it("a claim of the viewer's own may lead, it is work in progress", () => {
    const claimed = task({ status: "claimed", claimant: "0xme" });
    expect(canLeadFavour(claimed, "0xme")).toBe(true);
    expect(canLeadFavour(claimed, "0xother")).toBe(false);
  });

  it("a money pitch never leads, even on a board of nothing but pitches", () => {
    const s1 = task({ description: "just want to make money" });
    const s2 = task({ description: "Earn easy money from home" });
    expect(leadWithDoable([s1, s2], null)).toEqual([]);
    const a = task({ poster: "0xme" });
    expect(leadWithDoable([s1, a], "0xme").map((t) => t.id)).toEqual([a.id]);
    // The viewer's own pitch is never hidden from its poster.
    const minePitch = task({ poster: "0xme", description: "just want to make money" });
    expect(leadWithDoable([minePitch], "0xme").map((t) => t.id)).toEqual([minePitch.id]);
  });

  it("the only non-doable lead allowed: a board of the viewer's own posts, shown to them", () => {
    const a = task({ poster: "0xme" });
    const b = task({ poster: "0xme" });
    expect(leadWithDoable([a, b], "0xme").map((t) => t.id)).toEqual([a.id, b.id]);
    // To anyone else those same posts are doable and lead normally.
    expect(canLeadFavour(a, "0xstranger")).toBe(true);
  });

  it("a hidden piece does not count as an open piece, so it cannot carry a campaign to the top", () => {
    const hiddenPiece = [task({ id: "good-u", companyCampaignId: GOOD.id, hiddenAt: "2026-09-25T12:00:00Z" })];
    expect(canLeadCampaign(GOOD, hiddenPiece)).toBe(false);
    expect(canLeadCampaign(GOOD, [task({ id: "good-u", companyCampaignId: GOOD.id })])).toBe(true);
  });

  it("the starter card never offers a favour the viewer already delivered", () => {
    const done = task({ description: "Rate this app honestly", maxCompletions: 100, completionCount: 4 });
    const other = task({ description: "Tell us honestly about your street" });
    expect(pickStarterFavour([done], "0xme", NOW, new Set([done.id]))).toBeNull();
    expect(pickStarterFavour([done, other], "0xme", NOW, new Set([done.id]))?.id).toBe(other.id);
    expect(readFileSync("src/components/Feed.tsx", "utf8")).toMatch(/pickStarterFavour\(tasks, userId, Date\.now\(\), completedIds\)/);
  });

  it("the starter card and the daily mission obey the spam rule too", () => {
    const pitch = task({ description: "Tell us honestly how to make money right now where you are" });
    expect(pickStarterFavour([pitch], null, NOW)).toBeNull();
    expect(pickDailyMission([pitch], "2026-09-25", null, NOW)).toBeNull();
    const ok = task({ description: "Tell us honestly what it sounds like right now where you are" });
    expect(pickStarterFavour([ok], null, NOW)?.id).toBe(ok.id);
    expect(pickDailyMission([ok], "2026-09-25", null, NOW)?.id).toBe(ok.id);
  });

  it("a favour with no room left is not on offer", () => {
    expect(isBoardVisible(task({ maxCompletions: 1, completionCount: 1 }), null, NOW)).toBe(false);
    expect(isBoardVisible(task({ maxCompletions: 100, completionCount: 3 }), null, NOW)).toBe(true);
  });
});

describe("R16: the operator's hidden state", () => {
  it("a hidden task leaves the public list and the board, and is not deleted", () => {
    const hidden = task({ hiddenAt: "2026-09-25T12:00:00Z", hiddenReason: "spam" });
    expect(isPublicTask(hidden)).toBe(false);
    expect(isBoardVisible(hidden, null, NOW)).toBe(false);
    expect(isBoardVisible({ ...hidden, status: "claimed", claimant: "0xa" }, "0xa", NOW)).toBe(false);
    // orderBoardForApi never drops; the drop is isPublicTask's, upstream of it.
    expect(orderBoardForApi([hidden], NOW)).toHaveLength(1);
    expect(isPublicTask(task({ hiddenAt: null }))).toBe(true);
  });

  it("no API route writes hiddenAt: only scripts/hide-item.mjs does", async () => {
    const { execSync } = await import("node:child_process");
    const hits = execSync("grep -rl hiddenAt src/app || true", { encoding: "utf8" }).trim();
    expect(hits).toBe("");
    expect(readFileSync("scripts/hide-item.mjs", "utf8")).toMatch(/hiddenAt/);
  });

});

describe("R16 is wired into the Feed", () => {
  const feed = readFileSync("src/components/Feed.tsx", "utf8");
  it("campaign cards come from rankCampaignCards, never a raw map", () => {
    expect(feed).not.toMatch(/companyCampaigns\.map\(/);
    expect(feed).toMatch(/campaignCards\.lead\.map/);
    expect(feed).toMatch(/campaignCards\.rest\.map/);
    // The rest render after the favour list.
    expect(feed.indexOf("campaignCards.rest.map")).toBeGreaterThan(feed.indexOf("boardTasks : filtered).map"));
  });
  it("the favour list goes through leadWithDoable", () => {
    expect(feed).toMatch(/return leadWithDoable\(/);
  });
});
