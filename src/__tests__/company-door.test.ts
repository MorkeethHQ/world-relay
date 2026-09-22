import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pickCampaignToDo, openPiecesOf, productHost } from "@/lib/company-door";

// THE COMPANY DOOR (T3, 2026-09-22). "Do a piece and earn" is the first screen's
// main action; the company path is behind "For companies".

const camp = (id: string, publishedAt: string, companyChecked = false, ids: Record<string, string> = { ugc: `${id}-u` }) => ({
  id, company: id, brief: "b", pieces: [{ kind: "ugc" as const, count: 5 }, { kind: "review" as const, count: 3 }],
  rewardPerPiecePoints: 5, proposedPoolUsdc: 0, reviewRule: "ai" as const, publishedAt, pieceTaskIds: ids,
  status: "published" as const, companyChecked,
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
  it("prefers a checked company, then the longest-running campaign", () => {
    const tasks = [task("old-u"), task("new-u"), task("chk-u")];
    expect(pickCampaignToDo([camp("new", "2026-09-22"), camp("old", "2026-09-20")], tasks)?.campaign.id).toBe("old");
    const r = pickCampaignToDo([camp("new", "2026-09-22"), camp("old", "2026-09-20"), camp("chk", "2026-09-22", true)], tasks);
    expect(r?.campaign.id).toBe("chk");
    expect(r?.totalOpen).toBe(15);
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
    const cards = feed.indexOf("<CompanyCampaignCard key");
    const earn = feed.indexOf("<EarnCard");
    expect(earn).toBeGreaterThan(0);
    expect(mission).toBeGreaterThan(earn);
    expect(cards).toBeGreaterThan(mission);
  });
});
