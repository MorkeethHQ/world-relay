import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// FAVOUR-FEED-CONTRIBUTIONS-2026-09-21. Writing a favour from the feed, and real
// proofs to review. The repo has no DOM test environment, so these pin the rules in
// source; the behaviour itself is proven by the 390 px Playwright run in the PR.
const feed = readFileSync(join(__dirname, "../components/Feed.tsx"), "utf8");
const jury = readFileSync(join(__dirname, "../components/JuryMode.tsx"), "utf8");

function body(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nfunction |\nexport function /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the feed composer posts through the existing rules, not around them", () => {
  const composer = body(feed, "FeedComposer");

  it("posts to POST /api/tasks as the signed-in poster, points only", () => {
    expect(composer).toMatch(/fetch\("\/api\/tasks"/);
    expect(composer).toMatch(/poster: userId/);
    expect(composer).toMatch(/rewardType: "points"/);
    // Never USDC from the one-liner: money has its own page and its own gates.
    expect(composer).not.toMatch(/rewardType: "usdc/);
  });

  it("re-authenticates once on a lapsed session instead of dead-ending (PR 13 binding)", () => {
    expect(composer).toMatch(/retryAfterReauth\(await send\(\), send, onReauth\)/);
  });

  it("shows the server's refusal verbatim rather than inventing its own", () => {
    expect(composer).toMatch(/typeof data\.error === "string" \? data\.error/);
  });

  it("never posts on the person's behalf: no idea is auto-submitted", () => {
    expect(composer).not.toMatch(/QUICK_IDEAS/);
  });

  it("is rendered on the Favours tab for a signed-in person", () => {
    expect(feed).toMatch(/tab === "available" && !loading && userId && \(\s*<FeedComposer/);
  });
});

describe("review supply is real proofs only", () => {
  it("the review card renders only when real proofs are waiting, counted by the server", () => {
    expect(feed).toMatch(/reviewDeck\.length > 0 && reviewWaiting > 0 && pickProofStrip\(tasks\)\[0\] && \(\s*<ReviewProofCard/);
    expect(feed).toMatch(/waiting=\{reviewWaiting\}/);
    expect(feed).not.toMatch(/waiting=\{reviewDeck\.length\}/);
  });

  it("the deck comes from the jury route, the same source REAL OR NOT judges", () => {
    expect(feed).toMatch(/fetch\(`\/api\/jury\?address=\$\{encodeURIComponent\(userId\)\}`/);
  });

  it("the preview's deck is the deck that gets judged, so one visit issues one deck", () => {
    expect(feed).toMatch(/<JuryMode[^\n]*initialCards=\{reviewDeck\}/);
    expect(jury).toMatch(/if \(initialCards && initialCards\.length > 0\) return;/);
  });

  it("the preview is a REAL finished proof from the strip, never a card from the deck (which may be a decoy)", () => {
    expect(feed).toMatch(/proof=\{pickProofStrip\(tasks\)\[0\]\}/);
    expect(body(feed, "ReviewProofCard")).not.toMatch(/card\./);
  });
});

describe("an agent's ask carries the agent's name, honestly", () => {
  it("board cards use authorLabel, which names FAVOUR's own personas as such", () => {
    expect(feed).toMatch(/\{authorLabel\(task\) \?\? "Agent"\}/);
  });
});
