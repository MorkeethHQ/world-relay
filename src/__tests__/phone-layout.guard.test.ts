import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Oscar's phone review, 2026-09-21: "I dont like the small buttons with crammed
// text". Pinned so it cannot quietly come back.
const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");
const feed = read("components", "Feed.tsx");

describe("sticky headers are opaque", () => {
  it("no sticky header is translucent, so scrolled content never ghosts through it", () => {
    for (const f of [feed, read("components", "CompanyCampaign.tsx"), read("app", "polls", "page.tsx"), read("app", "history", "page.tsx")]) {
      expect(f).not.toMatch(/sticky top-0[^"]*bg-white\/95/);
    }
  });
});

describe("the pass panel's actions are one per row, 48 px, readable", () => {
  // 2026-10-05: the main action after a proof is "Discover more favours" (it was
  // "Back to favours", last and secondary). Share and Post a favour follow it.
  it("Discover more favours, Share and Post a favour stack full width at 48 px and 15 px text", () => {
    const at = feed.indexOf("+ Post a favour");
    const start = feed.lastIndexOf('<div className="flex flex-col gap-2">', at);
    expect(start).toBeGreaterThan(0);
    const block = feed.slice(start, at);
    expect(block).toMatch(/Discover more favours/);
    expect(block.indexOf("Discover more favours")).toBeLessThan(block.indexOf("Share"));
    // Discover is the dark main button and goes to onDone. The next Welcome
    // favour, when there is one, is the second, white button (acceptance, 5 Oct).
    expect(block).toMatch(/onClick=\{\(\) => \{ hapticTap\(\); onDone\(\); \}\}\s*className="[^"]*bg-gray-900[^"]*"\s*>\s*Discover more favours/);
    expect(block.indexOf("Discover more favours")).toBeLessThan(block.indexOf("Next Welcome favour"));
    expect(block).toMatch(/bg-white text-\[15px\] text-gray-900[^"]*"\s*>\s*Next Welcome favour/);
    expect((block.match(/w-full min-h-\[48px\]/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(block).not.toMatch(/text-xs/);
  });
});

describe("a sent proof is never cancelled (Oscar, 2026-10-05)", () => {
  const proof = feed.slice(feed.indexOf("function SubmitProof("), feed.indexOf("function TaskTimeline("));
  it("Cancel is offered only before anything is sent", () => {
    expect((proof.match(/>Cancel</g) || []).length).toBe(1);
    expect(proof).toMatch(/!result\s*\? \(submitting \? undefined : <Button variant="tertiary" size="sm" onClick=\{onCancel\}>Cancel<\/Button>\)/);
    expect(proof).toMatch(/\(result\.verdict === "pass" \|\| result\.verdict === "flag"\)\s*\? undefined/);
  });
  it("accepted and flagged both lead with Discover more favours", () => {
    const flag = proof.slice(proof.indexOf('result.verdict === "flag" && (() => {'), proof.indexOf('result.verdict === "unavailable" && ('));
    expect(flag.indexOf("Discover more favours")).toBeGreaterThan(0);
    expect(flag.indexOf("Discover more favours")).toBeLessThan(flag.indexOf("Send a new proof"));
    expect(flag).toMatch(/bg-gray-900 text-\[15px\] text-white[^"]*"\s*>\s*Discover more favours/);
  });
  // Measured in a real browser at 390 x 844 on 5 Oct: the form stayed above the
  // result and the main button sat at y 832 to 880, behind the bottom navigation.
  it("the entry form is not rendered once a result exists, so the result leads the screen", () => {
    expect(proof).toMatch(/\{!result && !submitting && \(\(\) => \{\s*const tier = getTaskTier/);
    // The pre-check and the submit bar were already hidden by a result.
    expect(proof).toMatch(/\{!result && !submitting && \(preChecking \|\| preCheck\) && \(/);
    expect(proof).toMatch(/\{!result && !submitting && \(\s*<div className="px-6 pb-8 pt-2"/);
    // Nothing is rendered between the top of the scroll area and the result
    // card except blocks that a result hides.
    const top = proof.indexOf('<div className="flex-1 overflow-y-auto');
    const card = proof.indexOf("{/* Verdict result */}");
    const between = proof.slice(top, card);
    const blocks = between.match(/^        \{[^/\n][^\n]*$/gm) || [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(b, b.trim()).toMatch(/^\s*\{(!result|submitting) && /);
  });
  it("the read-only summary of what was sent comes after the result, never before it", () => {
    expect(proof.indexOf("You sent")).toBeGreaterThan(proof.indexOf("{/* Verdict result */}"));
    expect(proof.indexOf('"You sent"')).toBeGreaterThan(proof.lastIndexOf("Discover more favours"));
  });
  it("the note and photos survive the result, so a resend does not start from nothing", () => {
    // Try again resubmits what is in state. The other ways back only clear
    // the result; none of them clears the note or the photos.
    expect(proof).toMatch(/onClick=\{\(\) => \{ setResult\(null\); handleSubmit\(\); \}\}[\s\S]{0,260}Try again/);
    expect(proof).not.toMatch(/setResult\(null\);[^}]*setProofNote\(/);
    expect(proof).not.toMatch(/setResult\(null\);[^}]*setImages\(/);
  });
  it("the result headings are sentence case on every favour", () => {
    expect(proof).not.toMatch(/"VERIFIED"|"REJECTED"|"TRY AGAIN"|"FLAGGED"/);
    expect(proof).toMatch(/result\.verdict === "pass" \? "Accepted"/);
  });
  it("a check that did not run is its own state, not a flag and not a fail", () => {
    expect(proof).toMatch(/down\.code === "check_unavailable"/);
    expect(proof).toMatch(/verdict: "unavailable"/);
    expect(proof).toMatch(/"Not checked"/);
  });
});

describe("a points favour carries no paid-tier time estimate", () => {
  // Seen in a real browser on 5 Oct: the Welcome "photo your first drink" read
  // "Full effort · 30+ min". The tier badge is an estimate for paid favours.
  const proof = feed.slice(feed.indexOf("function SubmitProof("), feed.indexOf("function TaskTimeline("));
  it("the tier badge with its time is shown only when the favour is not an unfunded points favour", () => {
    expect((proof.match(/\{tc\.label\} · \{tc\.time\}/g) || []).length).toBe(1);
    expect(proof).toMatch(/\{task\.rewardType === "points" && !isFunded\(task\) \? \([\s\S]{0,420}"Welcome favour" : "Points favour"[\s\S]{0,160}\) : \([\s\S]{0,220}\{tc\.label\} · \{tc\.time\}/);
  });
  it("the Welcome texts and their photo requirement are untouched by this", () => {
    const shape = read("lib", "welcome-shape.ts");
    expect(shape).toContain("Photo your first drink of the day (coffee, tea, water, anything) and tell us which city you're in. Your first taste of FAVOUR.");
    expect(proof).toMatch(/const needsPhoto = tierRequiresPhoto\(task\.category\);/);
  });
});

describe("board card chips are legible and never truncated", () => {
  it("no 10 px chip in the task card's chip row, and the agent chip is not truncated", () => {
    const at = feed.indexOf("{authorLabel(task) ?? \"Agent\"}");
    const row = feed.slice(at - 1400, at + 200);
    expect(row).not.toMatch(/text-\[10px\]/);
    expect(row).not.toMatch(/truncate max-w-\[120px\]/);
  });
});
