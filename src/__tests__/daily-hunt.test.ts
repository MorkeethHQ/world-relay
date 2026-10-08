import { describe, expect, it } from "vitest";
import type { FirstPage } from "@/lib/first-page";
import type { VoteRow } from "@/lib/product-votes";
import { HUNT_SIZE, huntApps, huntLine, isCodeHost, readHunt, recordStamp, stampOrNull, streakOf, utcDay, type HuntStore } from "@/lib/daily-hunt";

const W = "0x" + "a".repeat(40);
const NOW = Date.parse("2026-10-08T22:00:00Z");
const DAY = 86_400_000;

function memory(): HuntStore & { sets: Map<string, Set<string>> } {
  const sets = new Map<string, Set<string>>();
  const set = (k: string) => sets.get(k) ?? sets.set(k, new Set()).get(k)!;
  return { sets, add: async (k, m) => { const had = set(k).has(m); set(k).add(m); return had ? 0 : 1; }, members: async (k) => [...set(k)] };
}
const broken: HuntStore = { add: async () => { throw new Error("down"); }, members: async () => { throw new Error("down"); } };

describe("a stamp", () => {
  it("is one wallet, one app, one UTC day, and a repeat adds nothing", async () => {
    const s = memory();
    expect(await recordStamp(W, "vote:strive", NOW, s)).toEqual({ ok: true, stamps: ["vote:strive"] });
    expect(await recordStamp(W, "vote:strive", NOW, s)).toEqual({ ok: true, stamps: ["vote:strive"] });
    expect(await recordStamp(W, "review:abc", NOW, s)).toMatchObject({ ok: true });
    expect((await readHunt(W, NOW, s)).stamps).toEqual(["vote:strive", "review:abc"]);
    expect((await readHunt(W, NOW + DAY, s)).stamps).toEqual([]); // tomorrow is a new card
  });
  it("needs a World wallet and a well-formed stamp", async () => {
    expect(await recordStamp("dev_12345678", "vote:strive", NOW, memory())).toEqual({ ok: false, reason: "wallet_required" });
    expect(await recordStamp(W, "launch:hn_1", NOW, memory())).toEqual({ ok: false, reason: "bad_stamp" });
    expect(stampOrNull("vote:strive")).toBe("vote:strive");
    expect(stampOrNull("vote:../x")).toBeNull();
  });
  it("says not saved when the store is down or missing, and reads as unknown", async () => {
    expect(await recordStamp(W, "vote:strive", NOW, broken)).toEqual({ ok: false, reason: "unavailable" });
    expect(await recordStamp(W, "vote:strive", NOW, null)).toEqual({ ok: false, reason: "unavailable" });
    expect(await readHunt(W, NOW, broken)).toEqual({ day: "2026-10-08", stamps: null, streak: null });
    expect(await readHunt(null, NOW, memory())).toEqual({ day: "2026-10-08", stamps: null, streak: null });
  });
});

describe("days in a row", () => {
  it("counts UTC days with a stamp, ending today or yesterday", () => {
    const today = utcDay(NOW), y1 = utcDay(NOW - DAY), y2 = utcDay(NOW - 2 * DAY), y4 = utcDay(NOW - 4 * DAY);
    expect(streakOf([], NOW)).toBe(0);
    expect(streakOf([today], NOW)).toBe(1);
    expect(streakOf([today, y1, y2], NOW)).toBe(3);
    expect(streakOf([y1, y2], NOW)).toBe(2); // not yet stamped today: yesterday's run still stands
    expect(streakOf([y2, y4], NOW)).toBe(0); // a gap breaks it
    expect(streakOf([today, y1, y4], NOW)).toBe(2);
  });
  it("comes from the store, never from a guess", async () => {
    const s = memory();
    await recordStamp(W, "vote:strive", NOW - DAY, s);
    await recordStamp(W, "vote:strive", NOW, s);
    expect((await readHunt(W, NOW, s)).streak).toBe(2);
  });
});

const page = (rows: FirstPage["top"]["rows"]): FirstPage => ({
  top: { rows, products: rows.length, waiting: 0, acceptedToday: 0, acceptedTotal: 0, rankedBy: "newest" },
  launches: [
    { rank: 1, id: "hn_1", name: "K10s", line: "A Kubernetes TUI", url: "https://github.com/p10node/k10s", source: "Hacker News", sourceUrl: "https://news.ycombinator.com/item?id=1", score: 52, comments: 3, at: "2026-10-08T18:00:00Z" },
    { rank: 2, id: "hn_2", name: "Site", line: null, url: "https://example.com/", source: "Hacker News", sourceUrl: "https://news.ycombinator.com/item?id=2", score: 9, comments: 0, at: "2026-10-08T18:00:00Z" },
  ],
  pictures: {
    hn_1: { source: "share", url: "https://opengraph.githubassets.com/x/p10node/k10s", icon: "https://github.githubassets.com/favicons/favicon.png", credit: "From github.com", fallback: null },
    hn_2: { source: "none", url: null, icon: "https://example.com/favicon.ico", credit: "No picture yet", fallback: { initial: "S", hue: 10 } },
    c1: { source: "share", url: "https://agentic-strava.vercel.app/og.png", icon: "https://agentic-strava.vercel.app/favicon.svg", credit: "From agentic-strava.vercel.app", fallback: null },
  },
  at: "2026-10-08T22:00:00Z",
});
const votes: VoteRow[] = [
  { id: "strive", name: "STRIVE", line: "Post your strides", url: "https://agentic-strava.vercel.app/", host: "agentic-strava.vercel.app", image: "https://striverun.app/api/og", icon: "https://agentic-strava.vercel.app/favicon.svg", votes: null, mine: false },
  { id: "wave-radio", name: "Wave Radio", line: null, url: "https://waveradio-five.vercel.app/", host: "waveradio-five.vercel.app", image: null, icon: null, votes: 2, mine: true },
];

describe("the rail", () => {
  it("lists FAVOUR first, then the vote candidates, then outside launches, and never a candidate twice", () => {
    const row = { id: "c1", name: "STRIVE", company: "Oscar", makerChecked: false, points: 10, productUrl: "https://agentic-strava.vercel.app/", waiting: 0, accepted: 0, acceptedToday: 0, lastAcceptedAt: null, pieces: 1 } as unknown as FirstPage["top"]["rows"][number];
    const apps = huntApps(page([row]), votes);
    expect(apps.map((a) => `${a.kind}:${a.id}`)).toEqual(["favour:c1", "vote:wave-radio", "launch:hn_1", "launch:hn_2"]);
    expect(apps[0]).toMatchObject({ stamp: "review:c1", points: 10, picture: "https://agentic-strava.vercel.app/og.png" });
    expect(apps[1]).toMatchObject({ stamp: "vote:wave-radio", votes: 2, mine: true });
    expect(apps[2]).toMatchObject({ stamp: null, source: "Hacker News", score: 52 });
  });
  it("never shows a code host's icon as the app's picture", () => {
    const apps = huntApps(page([]), []);
    expect(isCodeHost("https://github.com/p10node/k10s")).toBe(true);
    expect(isCodeHost("https://example.com/")).toBe(false);
    expect(apps[0]).toMatchObject({ id: "hn_1", icon: null, picture: "https://opengraph.githubassets.com/x/p10node/k10s" });
    expect(apps[1]).toMatchObject({ id: "hn_2", icon: "https://example.com/favicon.ico", picture: null });
  });
});

describe("the status line", () => {
  it("prints a count only when there is one, and an unknown reads like an empty card", () => {
    expect(HUNT_SIZE).toBe(3);
    expect(huntLine(null)).toBe("Check 3 apps");
    expect(huntLine([])).toBe("Check 3 apps");
    expect(huntLine(["vote:a", "vote:b"])).toBe("2 of 3");
    expect(huntLine(["vote:a", "vote:b", "review:c", "vote:d"])).toBe("Card full. Back tomorrow.");
  });
});
