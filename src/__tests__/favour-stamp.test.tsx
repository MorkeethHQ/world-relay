// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { ProofPicture, stampPoints } from "@/components/FavourStamp";

// THE REWARD STAMP (Oscar, 11 Oct 2026: "1 yes, elegant stamp not the slop
// designed one though"). It is drawn only after a confirmed award.
afterEach(cleanup);

describe("the reward stamp", () => {
  it("is for an accepted points proof with a number from the server, and for nothing else", () => {
    expect(stampPoints({ verdict: "pass", pointsAwarded: 5 }, "points")).toBe(5);
    expect(stampPoints({ verdict: "pass", pointsAwarded: 7.4 }, "points")).toBe(7);
    expect(stampPoints(null, "points")).toBeNull();
    expect(stampPoints({ verdict: "flag", pointsAwarded: 5 }, "points")).toBeNull();
    expect(stampPoints({ verdict: "fail", pointsAwarded: 5 }, "points")).toBeNull();
    expect(stampPoints({ verdict: "unavailable" }, "points")).toBeNull();
    // No number from the server: the advertised price is never stamped.
    expect(stampPoints({ verdict: "pass" }, "points")).toBeNull();
    expect(stampPoints({ verdict: "pass", pointsAwarded: null }, "points")).toBeNull();
    expect(stampPoints({ verdict: "pass", pointsAwarded: 0 }, "points")).toBeNull();
    // Points are never drawn as money, and money gets no stamp.
    expect(stampPoints({ verdict: "pass", pointsAwarded: 5 }, "usdc")).toBeNull();
    expect(stampPoints({ verdict: "pass", pointsAwarded: 5 }, "usdc-v2")).toBeNull();
  });

  it("draws the picture always and the stamp only with points", () => {
    const task = { id: "t1", description: "Which sound would you turn off?", category: "feedback" };
    const a = render(<ProofPicture task={task} points={null} />).container;
    expect(a.querySelector("[data-art='sound']")).toBeTruthy();
    expect(a.querySelector("[data-stamp]")).toBeNull();
    cleanup();
    const b = render(<ProofPicture task={task} points={5} />).container;
    expect(b.querySelector("[data-stamp]")!.textContent).toBe("+5pts");
    expect(b.querySelector("[data-stamp]")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("is one quiet mark: no keyframe, no gradient, no dollar sign", () => {
    const css = readFileSync(join(__dirname, "..", "components", "FavourStamp.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const src = readFileSync(join(__dirname, "..", "components", "FavourStamp.tsx"), "utf8").replace(/\/\/.*$/gm, "");
    expect(css).not.toMatch(/@keyframes|gradient|infinite/i);
    expect(css).toMatch(/prefers-reduced-motion/);
    expect(src).not.toMatch(/\$|USDC/);
  });
});
