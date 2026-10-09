import { describe, expect, it } from "vitest";
import type { FirstPage } from "@/lib/first-page";
import type { VoteRow } from "@/lib/product-votes";
import { hallApps, hallOf, newestApps, rankApps, votesLabel, type HallApp } from "@/lib/hall";

// THE HALL (History tab, 9 Oct 2026): ranked by votes, accepted reviews break a
// tie, then the name. An unknown count is never zero and never ranked.

const app = (over: Partial<HallApp> & { id: string }): HallApp => ({
  kind: "vote", name: over.id, picture: null, icon: null, votes: null, accepted: 0, postedAt: null, source: null, ...over,
});

describe("rankApps", () => {
  it("ranks by votes, then accepted reviews, then the name", () => {
    const ranked = rankApps([
      app({ id: "b", name: "Beta", votes: 3, accepted: 0 }),
      app({ id: "a", name: "Alpha", votes: 3, accepted: 0 }),
      app({ id: "c", name: "Gamma", votes: 3, accepted: 2 }),
      app({ id: "d", name: "Delta", votes: 9 }),
    ]);
    expect(ranked.map((a) => `${a.rank}:${a.id}`)).toEqual(["1:d", "2:c", "3:a", "4:b"]);
  });

  it("never places an app with no known count, and never reads null as zero", () => {
    const ranked = rankApps([app({ id: "unknown", votes: null }), app({ id: "zero", votes: 0 })]);
    expect(ranked.map((a) => a.id)).toEqual(["zero"]);
    expect(ranked[0].rank).toBe(1);
  });
});

describe("hallOf", () => {
  it("has no ranks at all when no app has a known count, and keeps every app on the shelf", () => {
    const hall = hallOf([app({ id: "x" }), app({ id: "y", kind: "launch" })]);
    expect(hall.hasRanks).toBe(false);
    expect(hall.ranked).toEqual([]);
    expect(hall.unranked.map((a) => a.id)).toEqual(["x", "y"]);
  });

  it("splits ranked from unranked without losing an app", () => {
    const apps = [app({ id: "p", kind: "favour" }), app({ id: "v1", votes: 1 }), app({ id: "l", kind: "launch" }), app({ id: "v2", votes: 4 })];
    const hall = hallOf(apps);
    expect(hall.hasRanks).toBe(true);
    expect(hall.ranked.map((a) => a.id)).toEqual(["v2", "v1"]);
    expect(hall.unranked.map((a) => a.id)).toEqual(["p", "l"]);
    expect(hall.ranked.length + hall.unranked.length).toBe(apps.length);
  });
});

describe("newestApps", () => {
  it("puts products newest first, then launches in their own order, then the candidates", () => {
    const list = newestApps([
      app({ id: "v", kind: "vote" }),
      app({ id: "old", kind: "favour", postedAt: "2026-10-01T00:00:00Z" }),
      app({ id: "l2", kind: "launch" }),
      app({ id: "new", kind: "favour", postedAt: "2026-10-09T00:00:00Z" }),
      app({ id: "l1", kind: "launch" }),
      app({ id: "undated", kind: "favour", postedAt: null }),
    ]);
    expect(list.map((a) => a.id)).toEqual(["new", "old", "undated", "l2", "l1", "v"]);
  });
});

describe("hallApps", () => {
  const page: FirstPage = {
    top: {
      rows: [{ rank: 1, id: "draft_1", name: "Posted", company: "Co", productUrl: "https://posted.example/", points: 10, acceptedToday: 0, acceptedTotal: 5, reviewedTotal: 6, publishedAt: "2026-10-08T10:00:00Z", makerChecked: false, totalIsFloor: false }],
      products: 1, waiting: 0, acceptedToday: 0, acceptedTotal: 5, rankedBy: "total",
    },
    launches: [{ rank: 1, id: "hn_1", name: "K10s", line: null, url: "https://k10s.example/", source: "Hacker News", sourceUrl: "https://news.ycombinator.com/item?id=1", score: 52, comments: 3, at: "2026-10-08T18:00:00Z" }],
    pictures: { draft_1: { source: "share", url: "https://posted.example/og.png", icon: null, credit: "From posted.example", fallback: null } },
    at: "2026-10-09T00:00:00Z",
  };
  const votes: VoteRow[] = [
    { id: "strive", name: "STRIVE", line: null, url: "https://strive.example/", host: "strive.example", image: null, icon: null, votes: 2, mine: false },
    { id: "wave", name: "Wave", line: null, url: "https://wave.example/", host: "wave.example", image: null, icon: null, votes: null, mine: false },
  ];

  it("carries the vote count, the accepted count and the posted date from the two reads", () => {
    const apps = hallApps(page, votes);
    expect(apps.map((a) => `${a.kind}:${a.id}:${a.votes}:${a.accepted}:${a.postedAt ?? "-"}`)).toEqual([
      "favour:draft_1:null:5:2026-10-08T10:00:00Z",
      "vote:strive:2:0:-",
      "vote:wave:null:0:-",
      "launch:hn_1:null:0:-",
    ]);
    expect(apps[0].picture).toBe("https://posted.example/og.png");
    expect(apps[3].source).toBe("Hacker News");
  });

  it("gives the whole hall from the two reads: one ranked app, three unranked", () => {
    const hall = hallOf(hallApps(page, votes));
    expect(hall.ranked.map((a) => a.id)).toEqual(["strive"]);
    expect(hall.unranked.map((a) => a.id)).toEqual(["draft_1", "wave", "hn_1"]);
  });
});

describe("votesLabel", () => {
  it("says vote for one and votes otherwise", () => {
    expect(votesLabel(1)).toBe("1 vote");
    expect(votesLabel(0)).toBe("0 votes");
    expect(votesLabel(12)).toBe("12 votes");
  });
});
