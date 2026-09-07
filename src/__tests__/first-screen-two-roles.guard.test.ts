import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Oscar, 2026-09-07: "the current app is a mess: no favour images, points and
// placeholders, lost landing page, old and stale material."
//
// The first screen had said only "Real tasks. Real people. Verified on-chain."
// followed by a Tasks / Polls / Campaigns eyebrow strip. Three noun phrases and
// three category words. A stranger could not tell what the product is, who asks,
// who does the work, or why either side would come back.
//
// This guard fixes the two things that were actually wrong and can silently
// regress: (1) the signed-out landing screen and the onboarding must name BOTH
// roles, the side that asks and the side that does the work; (2) no surface may
// dress an unstarted favour in a stock photo. There is no media field on a task
// in src/lib/types.ts, so the only honest listing media is proofImageUrl, which
// exists only after a proof is submitted. public/hero/*.jpg are stock decor.
// Putting one on a favour card would be an invented favour image, which is worse
// than a blank card.
//
// Source assertions, in the style of design-system.guard.test.ts: for copy that
// is the product's own claim about itself, the source IS the behaviour.

const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");

const landing = read("app", "page.tsx");
const onboarding = read("components", "Onboarding.tsx");
const feed = read("components", "Feed.tsx");
const history = read("app", "history", "page.tsx");

describe("the signed-out first screen states the product and both roles", () => {
  it("says plainly what this is, without the old three-noun-phrase pitch", () => {
    expect(landing).toContain(
      "Companies ask for small real-world favours"
    );
    expect(landing).not.toContain("Real tasks. Real people.");
    expect(landing).not.toContain("Verified on-chain.");
  });

  it("names the requester side and what brings them back", () => {
    expect(landing).toContain("If you need something done");
    expect(landing).toContain("Post an ask and get proof back.");
    expect(landing).toMatch(/Post the same ask again/);
    // Campaigns are described, not offered: there is no user-facing campaign
    // create path (src/app/api/campaigns has only [id]; postCampaignId only
    // posts a favour INTO an existing campaign). Never promise the button.
    expect(landing).toMatch(/Companies run their recurring asks here as\s*\n?\s*campaigns/);
  });

  it("names the participant side and what they get", () => {
    expect(landing).toContain("If you want to do the work");
    expect(landing).toContain("Pick an open favour, do it, send proof.");
  });

  it("prints no adoption, activity or rating number on the first screen", () => {
    // Any bare 2+ digit number in the signed-out branch would be a claim about
    // the world. Font sizes and durations live in className/style strings, so
    // only look at rendered text between JSX tags.
    const signedOut = landing.slice(landing.indexOf("if (!userId)"));
    const textNodes = signedOut.match(/>\s*[^<>{}]{3,}\s*</g) ?? [];
    for (const node of textNodes) {
      expect(node).not.toMatch(/\b\d{2,}\b/);
    }
  });
});

describe("onboarding names the side that asks, not only the side that works", () => {
  it("says who posts the ask and that it repeats", () => {
    expect(onboarding).toMatch(/A company or an individual posts an ask/);
    expect(onboarding).toMatch(/campaign they\s*\n?\s*repeat/);
  });

  it("no longer claims the reward is points only", () => {
    expect(onboarding).not.toContain("Pass = points land in your account.");
    expect(onboarding).toMatch(/Orb-verified humans/);
  });
});

describe("empty states say they are empty before they teach", () => {
  it("the empty board leads with the fact that nothing is open", () => {
    expect(feed).toContain("No favours are open right now");
    expect(feed).toContain("Nothing below is a real listing.");
    // The old copy asserted a posting cadence nobody measures.
    expect(feed).not.toContain("new favours land twice a day");
  });

  it("history says what would fill it instead of a bare full stop", () => {
    expect(history).toContain("No completed favours yet");
    expect(history).toMatch(/with the photo that proved it/);
  });

  it("history never shows a wall of zeros as proof of life", () => {
    expect(history).toMatch(/stats\.volume\?\.paidOutUsdc \?\? 0\) === 0/);
    expect(history).toContain("Nothing has been paid out yet");
  });
});

describe("no favour is ever dressed in a stock photo", () => {
  it("keeps public/hero stock art off task and history cards", () => {
    // Feed uses /hero/cyclist.jpg once, on the REAL OR NOT game banner, which is
    // decoration for a game and not a claim about any favour. Nothing else may.
    const heroRefs = feed.match(/\/hero\/[a-z-]+\.jpg/g) ?? [];
    expect(heroRefs).toEqual(["/hero/cyclist.jpg"]);
    expect(history).not.toMatch(/\/hero\//);
    expect(landing).not.toMatch(/\/hero\//);
  });

  it("renders listing media only from a submitted proof", () => {
    expect(history).toContain("task.proofImageUrl && (");
    expect(feed).toContain("{task.proofImageUrl && (");
  });
});
