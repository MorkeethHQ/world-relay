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
  it("Share, Post a favour and Back to favours stack full width at 48 px and 15 px text", () => {
    const at = feed.indexOf("+ Post a favour");
    const start = feed.lastIndexOf('<div className="flex flex-col gap-2">', at);
    const end = feed.indexOf("Back to favours", at);
    expect(start).toBeGreaterThan(0);
    const block = feed.slice(start, end);
    expect((block.match(/w-full min-h-\[48px\]/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(block).not.toMatch(/text-xs/);
  });
});

describe("board card chips are legible and never truncated", () => {
  it("no 10 px chip in the task card's chip row, and the agent chip is not truncated", () => {
    const at = feed.indexOf("task.agent.name} asked");
    const row = feed.slice(at - 1400, at + 200);
    expect(row).not.toMatch(/text-\[10px\]/);
    expect(row).not.toMatch(/truncate max-w-\[120px\]/);
  });
});
