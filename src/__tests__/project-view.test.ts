import { describe, expect, it } from "vitest";
import type { CampaignResult, PublicCompanyCampaign } from "@/lib/campaign-draft-shape";
import type { Launch } from "@/lib/launch-feed";
import { RESULTS_SHOWN_MAX } from "@/lib/rank-campaigns";
import { favourProject, feedbackRound, launchProject, ownApps, progressLine, projectKind, reviewTarget, voteProject } from "@/lib/project-view";

const campaign = (extra: Partial<PublicCompanyCampaign> = {}): PublicCompanyCampaign => ({
  id: "draft_1", company: "STRIVE", brief: "Run one session and tell me if the map makes sense to you.",
  pieces: [{ kind: "review", count: 10 }], rewardPerPiecePoints: 10, proposedPoolUsdc: 0, reviewRule: "ai",
  publishedAt: "2026-10-08T10:00:00Z", pieceTaskIds: { review: "task_9" },
  productUrl: "https://www.agentic-strava.vercel.app/", productName: " STRIVE ",
  status: "published", companyChecked: false, ...extra,
});
const result = (verdict: CampaignResult["verdict"], at: string, participant = "0x1234…abcd"): CampaignResult =>
  ({ taskId: "task_9", kind: "review", verdict, reason: "the verifier's words", participant, at });

describe("which kind of app an id names", () => {
  it("tells a FAVOUR product, a launch and a candidate apart by the id alone", () => {
    expect(projectKind("draft_abc")).toBe("favour");
    expect(projectKind("hn_50016312")).toBe("launch");
    expect(projectKind("strive")).toBe("vote");
  });
  it("refuses an id that is not an id", () => {
    expect(projectKind("")).toBeNull();
    expect(projectKind("a/b")).toBeNull();
    expect(projectKind(42)).toBeNull();
    expect(projectKind("x".repeat(81))).toBeNull();
  });
});

describe("the feedback round", () => {
  it("counts only a review that passed, newest first, and keeps what the public list holds", () => {
    const r = feedbackRound(campaign(), [result("pass", "2026-10-08T11:00:00Z", "0xaaaa…0001"), result("fail", "2026-10-08T12:00:00Z"), result("flag", "2026-10-08T13:00:00Z"), result("pass", "2026-10-09T09:00:00Z", "0xbbbb…0002")]);
    expect(r.accepted).toBe(2);
    expect(r.acceptedIsFloor).toBe(false);
    expect(r.reviews.map((x) => x.participant)).toEqual(["0xbbbb…0002", "0xaaaa…0001"]);
    expect(Object.keys(r.reviews[0]).sort()).toEqual(["at", "kind", "participant"]); // never the verifier's reason, never an address
    expect(r.ask).toMatch(/map makes sense/);
  });

  it("uses the campaign's own review count as the target, and only then", () => {
    expect(reviewTarget(campaign())).toBe(10);
    expect(reviewTarget(campaign({ pieces: [{ kind: "review", count: 5 }, { kind: "ugc", count: 2 }] }))).toBeNull();
    expect(reviewTarget(campaign({ pieces: [{ kind: "ugc", count: 5 }] }))).toBeNull();
    expect(reviewTarget(campaign({ pieces: [] }))).toBeNull();
  });

  it("writes the progress line in one of three shapes", () => {
    expect(progressLine(3, false, 10)).toBe("3 of 10 reviews");
    expect(progressLine(1, false, null)).toBe("1 review in");
    expect(progressLine(4, false, null)).toBe("4 reviews in");
    expect(progressLine(30, true, 10)).toBe(`${RESULTS_SHOWN_MAX}+ reviews in`);
    expect(feedbackRound(campaign(), []).progress).toBe("0 of 10 reviews");
  });

  it("calls a full list a floor", () => {
    const full = Array.from({ length: RESULTS_SHOWN_MAX }, (_, i) => result("pass", `2026-10-0${1 + (i % 9)}T10:00:00Z`));
    expect(feedbackRound(campaign(), full).acceptedIsFloor).toBe(true);
  });
});

describe("the three kinds of project", () => {
  it("a product on FAVOUR carries the product and its round", () => {
    const p = favourProject(campaign(), [result("pass", "2026-10-08T11:00:00Z")], null)!;
    expect(p.kind).toBe("favour");
    expect(p.product.name).toBe("STRIVE");
    expect(p.round.accepted).toBe(1);
    expect(favourProject(campaign({ hidden: true }), [], null)).toBeNull();
  });

  it("a vote candidate takes its words from its page and its count from the server, or null", () => {
    const read = { ok: true as const, proposal: { name: "STRIVE", line: "One run.", image: "https://striverun.app/og.png", icon: null } };
    const p = voteProject({ id: "strive", url: "https://agentic-strava.vercel.app/" }, read, { votes: 4, mine: true })!;
    expect(p).toMatchObject({ kind: "vote", id: "strive", name: "STRIVE", host: "agentic-strava.vercel.app", votes: 4 });
    expect("mine" in p).toBe(false);
    expect(p.picture.url).toBe("https://striverun.app/og.png");
    expect(voteProject({ id: "strive", url: "https://agentic-strava.vercel.app/" }, read, { votes: null, mine: false })!.votes).toBeNull();
    expect(voteProject({ id: "strive", url: "https://agentic-strava.vercel.app/" }, read, null)!.votes).toBeNull();
  });

  it("a candidate whose page gave no name is not a project", () => {
    expect(voteProject({ id: "strive", url: "https://x.example/" }, { ok: false }, null)).toBeNull();
    expect(voteProject({ id: "strive", url: "https://x.example/" }, { ok: true, proposal: { name: null, line: null, image: null, icon: null } }, null)).toBeNull();
  });

  it("a launch keeps its source and number, with the initial when its page could not be read", () => {
    const launch: Launch = { rank: 1, id: "hn_1", name: "Quake in Rust", line: "playable in browser", url: "https://quake-srp.pages.dev/", source: "Hacker News", sourceUrl: "https://news.ycombinator.com/item?id=1", score: 52, comments: 3, at: "2026-10-09T01:00:00Z" };
    const p = launchProject(launch, { ok: false });
    expect(p).toMatchObject({ kind: "launch", source: "Hacker News", score: 52, host: "quake-srp.pages.dev" });
    expect(p.picture.url).toBeNull();
    expect(p.picture.fallback?.initial).toBe("Q");
    expect(launchProject(launch, { ok: true, proposal: { name: "Quake", line: null, image: "https://quake-srp.pages.dev/og.png", icon: null } }).picture.url).toBe("https://quake-srp.pages.dev/og.png");
  });
});

describe("the person's own apps", () => {
  it("lists only what is on FAVOUR with a product, newest first", () => {
    const rows = ownApps([
      { id: "draft_a", status: "published", productName: "A", productUrl: "https://a.example/", publishedAt: "2026-10-01T00:00:00Z" },
      { id: "draft_b", status: "draft", productName: "B", productUrl: "https://b.example/" },
      { id: "draft_c", status: "publishing", productName: "C", productUrl: "https://c.example/", publishedAt: "2026-10-05T00:00:00Z" },
      { id: "draft_d", status: "published", productName: undefined, productUrl: "https://d.example/" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["draft_c", "draft_a"]);
    expect(rows[0].host).toBe("c.example");
  });
});
