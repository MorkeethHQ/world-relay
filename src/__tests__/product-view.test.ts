import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { productView, reviewOutcome, reviewReason, REVIEW_MAX } from "@/lib/product-view";
import { firstPage, type FirstPageDeps } from "@/lib/first-page";
import type { PublicCompanyCampaign } from "@/lib/campaign-draft-shape";

const campaign = (extra: Partial<PublicCompanyCampaign> = {}): PublicCompanyCampaign => ({
  id: "draft_1", company: "STRIVE", brief: "Run one session and tell me if the map makes sense to you.",
  pieces: [{ kind: "review", count: 10 }], rewardPerPiecePoints: 10, proposedPoolUsdc: 0, reviewRule: "ai",
  publishedAt: "2026-10-08T10:00:00Z", pieceTaskIds: { review: "task_9" },
  productUrl: "https://www.agentic-strava.vercel.app/", productName: " STRIVE ",
  status: "published", companyChecked: false, ...extra,
});
const record = { makerImage: null, shareImage: "https://agentic-strava.vercel.app/og.png", icon: null, colour: "#111111", line: "A run is one session.", readAt: "2026-10-08T10:00:00Z" };

describe("what the product screen shows", () => {
  it("shows the maker's ask, the points, the picture from the record and the review task", () => {
    const v = productView(campaign(), [{ verdict: "pass" }, { verdict: "fail" }, { verdict: "flag" }], record)!;
    expect(v).toMatchObject({
      name: "STRIVE", line: "A run is one session.", points: 10, host: "agentic-strava.vercel.app",
      reviewTaskId: "task_9", accepted: 1, acceptedIsFloor: false, makerChecked: false,
    });
    expect(v.ask).toMatch(/map makes sense/);
    expect(v.picture.url).toBe("https://agentic-strava.vercel.app/og.png");
  });

  it("shows no picture it was not given, and no review task that does not exist", () => {
    const v = productView(campaign({ pieceTaskIds: {} }), [], null)!;
    expect(v.picture.url).toBeNull();
    expect(v.line).toBeNull();
    expect(v.reviewTaskId).toBeNull();
  });

  it("is nothing for a hidden campaign or one that names no product", () => {
    expect(productView(campaign({ hidden: true }), [], record)).toBeNull();
    expect(productView(campaign({ productName: undefined }), [], record)).toBeNull();
    expect(productView(campaign({ productUrl: undefined }), [], record)).toBeNull();
  });

  it("marks the count as a floor when the results list is full", () => {
    const full = Array.from({ length: 30 }, () => ({ verdict: "pass" as const }));
    expect(productView(campaign(), full, null)).toMatchObject({ accepted: 30, acceptedIsFloor: true });
  });

  it("names a company only when Oscar checked it", () => {
    expect(productView(campaign({ companyChecked: true }), [], null)!.makerChecked).toBe(true);
  });
});

describe("when a review may be sent", () => {
  it("asks for 20 words, and takes a link by itself", () => {
    expect(reviewReason("  ")).toMatch(/Write your review/);
    expect(reviewReason("too short")).toMatch(/20 words or more\. You have 2\./);
    expect(reviewReason(Array(20).fill("word").join(" "))).toBeNull();
    expect(reviewReason("https://example.com/my-review")).toBeNull();
    expect(reviewReason("http://example.com/my-review")).not.toBeNull();
    expect(reviewReason("x".repeat(REVIEW_MAX + 1))).toMatch(/under 1000/);
  });
});

describe("what a review came back as", () => {
  it("is accepted only on a pass, with the points the server gave", () => {
    expect(reviewOutcome(200, { verification: { verdict: "pass" }, pointsAwarded: 10 })).toEqual({ kind: "passed", points: 10 });
    expect(reviewOutcome(200, { verification: { verdict: "pass" } })).toEqual({ kind: "passed", points: null });
  });

  it("gives the check's own reason when it did not pass", () => {
    expect(reviewOutcome(200, { verification: { verdict: "fail", reasoning: "raw" }, personTip: "Say what you tried." }))
      .toEqual({ kind: "not_passed", reason: "Say what you tried." });
    expect(reviewOutcome(200, { verification: { verdict: "fail", reasoning: "It names no feature." } }))
      .toEqual({ kind: "not_passed", reason: "It names no feature." });
  });

  it("calls a flag held, never accepted and never refused", () => {
    expect(reviewOutcome(200, { verification: { verdict: "flag", reasoning: "Looks copied." } })).toEqual({ kind: "held", reason: "Looks copied." });
  });

  it("never reads a reply with no verdict as a pass", () => {
    for (const data of [{}, null, { verification: {} }, { verification: { verdict: "PASS" } }, { pointsAwarded: 10 }]) {
      expect(reviewOutcome(200, data).kind).toBe("problem");
    }
  });

  it("sends a person with no session to sign in, and does not offer to resend", () => {
    expect(reviewOutcome(403, { code: "reauth_required", error: "x" })).toMatchObject({ kind: "problem", signIn: true, again: false });
    expect(reviewOutcome(401, { error: "Submitter identity required" })).toMatchObject({ kind: "problem", signIn: true });
  });

  it("says nothing was judged when the check could not run", () => {
    expect(reviewOutcome(503, { code: "check_unavailable", error: "The check is down. Nothing was scored." }))
      .toEqual({ kind: "problem", text: "The check is down. Nothing was scored.", signIn: false, again: true });
    expect(reviewOutcome(500, null)).toMatchObject({ kind: "problem", again: true });
  });

  it("uses the server's words for a refusal", () => {
    expect(reviewOutcome(409, { code: "already_completed", error: "You already completed this favour." })).toMatchObject({ text: "You already completed this favour.", again: false });
    expect(reviewOutcome(403, { error: "Daily limit reached", message: "Come back tomorrow." })).toMatchObject({ text: "Come back tomorrow.", signIn: false });
    expect(reviewOutcome(403, { error: "Can't submit proof for your own task" })).toMatchObject({ text: "Can't submit proof for your own task" });
  });
});

describe("the first page, built on the server", () => {
  const launch = { rank: 1, id: "hn_1", name: "Tool", line: null, url: "https://tool.test/", score: 12, source: "Hacker News", at: "2026-10-08T09:00:00Z" };
  const deps = (extra: Partial<FirstPageDeps> = {}): FirstPageDeps => ({
    campaigns: async () => [campaign(), campaign({ id: "draft_2", productName: undefined })],
    results: async () => [{ taskId: "t", kind: "review", verdict: "pass", reason: "", participant: "0x12…ab", at: "2026-10-08T11:00:00Z" }],
    picture: async () => record,
    launches: async () => [launch as never],
    readPage: async () => ({ ok: false, reason: "no" }) as never,
    ...extra,
  });
  const NOW = Date.parse("2026-10-08T12:00:00Z");

  it("ranks products, counts today's accepted reviews and gives every row a picture", async () => {
    const page = await firstPage(deps(), NOW);
    expect(page.top).toMatchObject({ products: 1, waiting: 1, acceptedToday: 1, rankedBy: "today" });
    expect(page.pictures.draft_1.url).toBe("https://agentic-strava.vercel.app/og.png");
    expect(page.pictures.draft_2).toBeUndefined();
    expect(page.pictures.hn_1.url).toBeNull(); // its page could not be read: the row shows its initial
    expect(page.launches).toHaveLength(1);
  });

  it("still shows FAVOUR's products when the outside list, a page, the results or a picture cannot be read", async () => {
    const fail = async () => { throw new Error("down"); };
    const page = await firstPage(deps({ launches: fail, results: fail, picture: fail, readPage: fail }), NOW);
    expect(page.launches).toEqual([]);
    expect(page.top).toMatchObject({ products: 1, acceptedToday: 0, rankedBy: "newest" });
    expect(page.pictures.draft_1.url).toBeNull();
  });

  it("does not hide a failure to read the list of campaigns", async () => {
    await expect(firstPage(deps({ campaigns: async () => { throw new Error("down"); } }), NOW)).rejects.toThrow();
  });
});

describe("ProductScreen keeps the flow's rules", () => {
  const src = readFileSync(join(__dirname, "..", "components", "ProductScreen.tsx"), "utf8");

  it("sends the review as the session's own address, never one the screen chose", () => {
    expect(src).toMatch(/submitter: session\.address/);
    expect(src).not.toMatch(/localStorage/);
  });

  it("names no money", () => {
    expect(src).not.toMatch(/USDC|>\$|proposedPool/);
  });

  it("ends every state with a next step", () => {
    for (const label of ["Write your review", "Send for check", "Review another product", "Change my review", "Try again", "See today&apos;s products", "Open FAVOUR and sign in"]) {
      expect(src, label).toContain(label);
    }
  });
});
