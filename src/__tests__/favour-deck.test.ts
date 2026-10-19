import { describe, expect, it } from "vitest";
import { bumpStreak, cardFromHn, cardFromProject, orderDeck, readStreak, rightLabel, splitShowHnTitle, type DeckCard } from "@/lib/deck-view";
import { OSCAR_SEEDS, mergeSeeds, seedCard } from "@/lib/deck-seed";
import { parseHnHits } from "@/lib/hn";
import { funkyArt } from "@/lib/funky-art";
import { feedbackerBadge, reviewerBadge } from "@/lib/badges";
import type { ProjectCard } from "@/lib/projects-view";

const project = (over: Partial<ProjectCard> = {}): ProjectCard => ({
  id: "draft_1", name: "STRIVE", url: "https://agentic-strava.vercel.app", host: "agentic-strava.vercel.app", ask: "Try one task.",
  image: null, yes: 10, of: 10, status: "published", fromOtherSource: false, pieces: [], points: 10, publishedAt: "2026-10-01", ...over,
});

describe("Show HN cards are data, never favours", () => {
  it("parses only Show HN hits with an https link or the thread as the link", () => {
    const hits = parseHnHits({ hits: [
      { objectID: "1", title: "Show HN: Foo – a thing", url: "https://foo.dev", author: "a", points: 30, num_comments: 2, created_at: "2026-10-19" },
      { objectID: "2", title: "Ask HN: what", url: "https://x.dev", author: "b", points: 3, num_comments: 0, created_at: "" },
      { objectID: "3", title: "Show HN: No link", url: null, author: "c", points: 20, num_comments: 1, created_at: "" },
    ] });
    expect(hits.map((h) => h.objectID)).toEqual(["1", "3"]);
    const c = cardFromHn(hits[1]);
    expect(c.url).toBe("https://news.ycombinator.com/item?id=3");
    expect(c.foundElsewhere).toBe(true);
    expect(c.projectId).toBeNull();
    expect(c.points).toBe(0);
    expect(rightLabel(c)).toBe("Looks good");
  });
  it("splits the title into name and line", () => {
    expect(splitShowHnTitle("Show HN: Foo – a thing that does X")).toEqual({ name: "Foo", line: "a thing that does X" });
    expect(splitShowHnTitle("Show HN: Just a name")).toEqual({ name: "Just a name", line: "" });
  });
});

describe("The deck order", () => {
  it("puts Oscar's projects first, then posted, then HN by points, seen cards last", () => {
    const hn1 = cardFromHn({ objectID: "9", title: "Show HN: A", url: "https://a.dev", author: "x", points: 5, num_comments: 0, created_at: "" });
    const hn2 = cardFromHn({ objectID: "8", title: "Show HN: B", url: "https://b.dev", author: "x", points: 50, num_comments: 0, created_at: "" });
    const posted = cardFromProject(project({ id: "p1", name: "Other" }));
    const mine = seedCard(OSCAR_SEEDS[0]);
    const out = orderDeck([hn1, posted, hn2, mine], new Set(["p1"]));
    expect(out.map((c) => c.id)).toEqual([mine.id, "hn:8", "hn:9", "p1"]);
  });
  it("a posted live project with a seed's name takes the front with its own id and no banner", () => {
    const posted = [cardFromProject(project({ fromOtherSource: true })), cardFromProject(project({ id: "p2", name: "MDM", host: "mdm.app", fromOtherSource: true }))];
    const { front, rest } = mergeSeeds(OSCAR_SEEDS, posted);
    expect(front[0].id).toBe("draft_1");
    expect(front[0].source).toBe("oscar");
    expect(front[0].foundElsewhere).toBe(false);
    expect(front.length).toBe(OSCAR_SEEDS.length);
    expect(rest.map((c) => c.id)).toEqual(["p2"]);
    expect(rest[0].foundElsewhere).toBe(true);
  });
  it("names the right swipe by what it pays", () => {
    expect(rightLabel(cardFromProject(project()))).toBe("Review it, 10 pts");
    expect(rightLabel(cardFromProject(project(), "posted", 2))).toBe("Review it, 2 USDC");
    expect(rightLabel(cardFromProject(project({ status: "pending", yes: 3 })))).toBe("Try it, say YES");
  });
});

describe("The streak is the viewer's own count", () => {
  it("starts at one, grows on consecutive days, resets after a gap", () => {
    const d1 = new Date(2026, 9, 19, 10);
    const s1 = bumpStreak(null, d1);
    expect(s1).toEqual({ days: 1, last: "2026-10-19", today: 1 });
    expect(bumpStreak(s1, d1).today).toBe(2);
    const s2 = bumpStreak(s1, new Date(2026, 9, 20, 9));
    expect(s2.days).toBe(2);
    expect(bumpStreak(s2, new Date(2026, 9, 25, 9)).days).toBe(1);
  });
  it("refuses a bad stored value", () => {
    expect(readStreak("nope")).toBeNull();
    expect(readStreak({ days: "3" })).toBeNull();
    expect(readStreak(JSON.stringify({ days: 3, last: "2026-10-19" }))).toEqual({ days: 3, last: "2026-10-19", today: 0 });
  });
});

describe("Funky art and badges", () => {
  it("is steady for a name, never violet, never the brand blue", () => {
    const a = funkyArt("STRIVE");
    expect(a).toBe(funkyArt("STRIVE"));
    expect(a.startsWith("data:image/svg+xml")).toBe(true);
    const hue = Number(decodeURIComponent(a).match(/hsl\((\d+) /)![1]);
    expect(hue >= 240 && hue <= 300).toBe(false);
    expect(hue === 225).toBe(false);
  });
  it("levels the reviewer at 1, 5, 10, 25", () => {
    expect(reviewerBadge(0).level).toBe(0);
    expect(reviewerBadge(5).level).toBe(2);
    expect(reviewerBadge(9).next).toBe(10);
    expect(reviewerBadge(30).next).toBeNull();
    expect(feedbackerBadge(3).level).toBe(2);
  });
});

describe("A card is never a wallet", () => {
  it("carries no address field", () => {
    const c: DeckCard = cardFromProject(project());
    expect(Object.keys(c).some((k) => /wallet|address|owner/i.test(k))).toBe(false);
  });
});
