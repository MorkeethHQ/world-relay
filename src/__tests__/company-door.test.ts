import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pickCampaignToDo, openPiecesOf, productHost } from "@/lib/company-door";

// THE COMPANY DOOR (T3, 2026-09-22). "Do a piece and earn" is the first screen's
// main action; the company path is behind "For companies".

// A brief that passes today's publish gate (MIN_BRIEF_WORDS = 20).
const BRIEF = "Short honest clips and reviews of our handmade coffee from people who actually tried it at home this week, with one thing they liked and one they did not.";
const camp = (id: string, publishedAt: string, companyChecked = false, ids: Record<string, string> = { ugc: `${id}-u` }) => ({
  id, company: id, brief: BRIEF, pieces: [{ kind: "ugc" as const, count: 5 }, { kind: "review" as const, count: 3 }],
  rewardPerPiecePoints: 5, proposedPoolUsdc: 0, reviewRule: "ai" as const, publishedAt, pieceTaskIds: ids,
  status: "published" as const, companyChecked, productName: `${id} product`, productUrl: `https://example.com/${id}`,
});
const task = (id: string, status = "open", maxCompletions = 5, completionCount = 0) => ({ id, status, maxCompletions, completionCount }) as any;

describe("which campaign 'Do a piece and earn' opens", () => {
  it("counts only open pieces with room that this person has not delivered", () => {
    const c = camp("a", "2026-09-20", false, { ugc: "a-u", review: "a-r" });
    expect(openPiecesOf(c, [task("a-u", "open", 5, 2), task("a-r", "open", 3, 3)])).toBe(3);
    expect(openPiecesOf(c, [task("a-u", "open", 5, 2)], new Set(["a-u"]))).toBe(0);
    expect(openPiecesOf(c, [task("a-u", "expired")])).toBe(0);
  });
  it("returns null when nothing is open, so the card is not shown", () => {
    expect(pickCampaignToDo([camp("a", "2026-09-20")], [task("a-u", "completed")])).toBeNull();
  });
  it("offers only a checked company (R16), the longest-running first", () => {
    const tasks = [task("old-u"), task("new-u"), task("chk-u"), task("chk2-u")];
    // R16 (2026-09-25): an unverified company is never the first screen's main action.
    expect(pickCampaignToDo([camp("new", "2026-09-22"), camp("old", "2026-09-20")], tasks)).toBeNull();
    const r = pickCampaignToDo([camp("new", "2026-09-22"), camp("old", "2026-09-20"), camp("chk", "2026-09-22", true), camp("chk2", "2026-09-19", true)], tasks);
    expect(r?.campaign.id).toBe("chk2");
    expect(r?.totalOpen).toBe(10);
  });
  it("shows only the host of a product link", () => {
    expect(productHost("https://www.filipinolokal.com/x?y=1")).toBe("filipinolokal.com");
    expect(productHost(undefined)).toBeNull();
  });
});

describe("the first screen leads with doing, not with planning", () => {
  const feed = readFileSync("src/components/Feed.tsx", "utf8");
  const onboarding = readFileSync("src/components/Onboarding.tsx", "utf8");
  const cc = readFileSync("src/components/CompanyCampaign.tsx", "utf8");
  it("the main button reads 'Do a piece and earn'", () => {
    expect(cc).toMatch(/>\s*Do a piece and earn\s*</);
    expect(feed).toMatch(/<EarnCard/);
    expect(onboarding).toMatch(/<EarnCard/);
  });
  it("the board no longer shows the company vision card inline; it is behind For companies", () => {
    expect(feed).not.toMatch(/<CompanyVisionCard/);
    expect(feed).toMatch(/setView\("companies"\)/);
    expect(onboarding).toMatch(/forCompanies && <CompanyVisionCard/);
  });
  it("every campaign surface carries the company's trust label", () => {
    expect(cc).toMatch(/Unverified company/);
    expect((cc.match(/<CompanyTrust /g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(feed).toMatch(/<CompanyTrust c=\{pieceCampaign\}/);
  });
  it("an unverified company's link opens safely and is marked as user content", () => {
    expect(cc).toMatch(/rel="noopener noreferrer nofollow ugc"/);
  });
});

describe("the board's order after the company door", () => {
  const feed = readFileSync("src/components/Feed.tsx", "utf8");
  it("today's mission comes before the list of campaign cards", () => {
    const mission = feed.indexOf("<DailyMissionCard");
    const cards = feed.indexOf("campaignCards.lead.map");
    const earn = feed.indexOf("<EarnCard");
    expect(earn).toBeGreaterThan(0);
    expect(mission).toBeGreaterThan(earn);
    expect(cards).toBeGreaterThan(mission);
  });
});


describe("a campaign that has not named its product is not offered", () => {
  it("'Do a piece and earn' skips it, even when it is the longest-running", () => {
    const tasks = [task("old-u"), task("new-u")];
    const old = { ...camp("old", "2026-09-20", true), productName: undefined, productUrl: undefined };
    expect(pickCampaignToDo([old, camp("new", "2026-09-22", true)], tasks)?.campaign.id).toBe("new");
    expect(pickCampaignToDo([old], tasks)).toBeNull();
  });
  it("a name without a link, or a link without a name, is not a product", () => {
    const tasks = [task("a-u")];
    expect(pickCampaignToDo([camp("a", "2026-09-20", true)], tasks)?.campaign.id).toBe("a");
    expect(pickCampaignToDo([{ ...camp("a", "2026-09-20", true), productUrl: undefined }], tasks)).toBeNull();
    expect(pickCampaignToDo([{ ...camp("a", "2026-09-20", true), productName: undefined }], tasks)).toBeNull();
  });
  it("every campaign surface shows the product, or says there is none", () => {
    const cc = readFileSync("src/components/CompanyCampaign.tsx", "utf8");
    const feed = readFileSync("src/components/Feed.tsx", "utf8");
    const shape = readFileSync("src/lib/campaign-draft-shape.ts", "utf8");
    expect(shape).toMatch(/NO_PRODUCT_YET = "This company hasn't named a product yet"/);
    expect((cc.match(/<ProductLine c=\{c\}/g) ?? []).length).toBe(2); // card and campaign page
    expect(feed).toMatch(/<ProductLine c=\{pieceCampaign\}/); // proof step
    expect(cc).toMatch(/const open = hasProduct\(c\) && /); // no Join without a product
  });
});
