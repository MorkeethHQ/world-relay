// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { ART_SETS, FavourArt, artFor, artHash, artKind } from "@/components/FavourArt";

// FAVOUR ART (11 Oct 2026): a drawing for a favour with no picture of its own.
afterEach(cleanup);

describe("favour art", () => {
  it("gives one favour one picture, every time", () => {
    const a = render(<FavourArt kind="say" seed="t-1" />).container.innerHTML;
    cleanup();
    expect(render(<FavourArt kind="say" seed="t-1" />).container.innerHTML).toBe(a);
    expect(artHash("t-1")).toBe(artHash("t-1"));
  });

  it("is decoration to a screen reader, and has a shape for every kind", () => {
    for (const kind of ["say", "photo", "place", "review", "share", "welcome", "judge", "sound", "air", "door", "cup"] as const) {
      const svg = render(<FavourArt kind={kind} seed="x" />).container.querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.children.length).toBeGreaterThan(1);
      cleanup();
    }
  });

  it("maps a category to a kind, and an unknown one to a thing to say", () => {
    expect(artKind("photo")).toBe("photo");
    expect(artKind("check-in")).toBe("place");
    expect(artKind("review")).toBe("review");
    expect(artKind("something-new")).toBe("say");
    expect(artKind(null)).toBe("say");
  });

  it("takes the picture from the favour's own words first", () => {
    expect(artFor({ description: "Which sound near you would you turn off?", category: "feedback" })).toBe("sound");
    expect(artFor({ description: "Photo the nearest door to you", category: "photo" })).toBe("door");
    expect(artFor({ description: "What does the air smell like?", category: "feedback" })).toBe("air");
    expect(artFor({ description: "Tell us one thing", category: "photo" })).toBe("photo");
    expect(artFor({ description: null, category: null })).toBe("say");
  });

  it("uses flat colour only: no gradient, no keyframe, no image", () => {
    const src = readFileSync(join(__dirname, "..", "components", "FavourArt.tsx"), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/gradient|keyframes|<image|<img/i);
    expect(ART_SETS.length).toBeGreaterThanOrEqual(6);
  });
});
