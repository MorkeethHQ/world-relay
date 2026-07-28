import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * GUARD: nothing may widen the layout viewport, and the bottom nav may not
 * depend on the screen being wide enough.
 *
 * Born from the World dev portal rejection (Jul 2026): "nav bar icons exceed
 * screen on ios". The nav itself was never too wide — 5 items x 56px = 280px
 * fits a 320px screen. The cause is that on iOS a single horizontally
 * overflowing element widens the LAYOUT viewport, and `position: fixed`
 * elements are laid out against the layout viewport, so the nav stretched with
 * it and its right-hand icons went off-screen. Measured against the live app:
 * injecting one 600px element moved window.innerWidth from 320 to 600 and took
 * the nav's width with it, with `overflow-x: hidden` already on <body>.
 *
 * These are source-level assertions on purpose. The failure is a rendering one
 * that only reproduces in a mobile webview, so the thing worth locking is the
 * defence, not the symptom — otherwise a future refactor quietly removes it and
 * the app eats another multi-week store review cycle.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

/** Strip comments, so a rule quoted in a comment can never satisfy a guard. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every rule block whose selector list contains `sel`, comments removed. */
const rulesFor = (css: string, sel: string) =>
  [...code(css).matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => m[1].split(",").some((s) => s.trim() === sel))
    .map((m) => m[2]);

describe("viewport containment (World review, iOS nav overflow)", () => {
  const css = read("src", "app", "globals.css");

  it("clips horizontal overflow in place, via .viewport-clip", () => {
    // `hidden` on <body> is what we had, and it did NOT stop the layout
    // viewport from expanding — it propagates to the viewport instead of
    // clipping. It must be `clip`, on a non-root element.
    const clip = rulesFor(css, ".viewport-clip");
    expect(clip.length, "globals.css must define .viewport-clip").toBeGreaterThan(0);
    expect(clip.some((r) => /overflow-x:\s*clip/.test(r))).toBe(true);
  });

  it("applies the clip to <main>, wrapping every page", () => {
    const layout = code(read("src", "app", "layout.tsx"));
    expect(layout).toMatch(/<main[^>]*viewport-clip/);
  });

  it("never puts an overflow on the root, which detaches sticky headers", () => {
    // Measured: `overflow-x: clip` on <html> makes the root a scroll container
    // and the `sticky top-0` headers on /history and /polls scroll away.
    for (const sel of ["html", "body"]) {
      expect(
        rulesFor(css, sel).some((r) => /overflow-x:\s*(clip|hidden|auto|scroll)/.test(r)),
        `${sel} must not carry an overflow-x`
      ).toBe(false);
    }
    const layout = code(read("src", "app", "layout.tsx"));
    expect(layout, "<body> must not carry overflow-x-hidden").not.toMatch(
      /<body[^>]*overflow-x-(hidden|clip|auto|scroll)/
    );
  });

  it("pins text scaling so iOS cannot inflate nav labels", () => {
    expect(css).toMatch(/-webkit-text-size-adjust:\s*100%/);
  });

  it("breaks unbreakable user text instead of overflowing", () => {
    // Live favour descriptions include bare 42-char wallet addresses, which are
    // wider than a 320px screen and will not wrap on their own.
    const body = rulesFor(css, "body");
    expect(body.some((r) => /overflow-wrap:\s*(break-word|anywhere)/.test(r))).toBe(true);
  });

  it("caps media at the container width", () => {
    expect(code(css)).toMatch(/img[^{]*\{[^}]*max-width:\s*100%/);
  });
});

describe("BottomNav cannot exceed the screen", () => {
  const nav = code(read("src", "components", "BottomNav.tsx"));

  it("divides the row instead of giving each item a fixed minimum width", () => {
    // 5 x min-w-[56px] = 280px, which fits 320px only until a label grows.
    expect(nav).not.toMatch(/min-w-\[\d+px\]/);
    expect(nav).toMatch(/flex-1/);
    expect(nav).toMatch(/min-w-0/);
  });

  it("truncates labels rather than letting them push the row wider", () => {
    expect(nav).toMatch(/truncate/);
  });

  it("keeps the 44px minimum tap target", () => {
    expect(nav).toMatch(/min-h-\[44px\]/);
  });

  it("still respects the iOS home-indicator safe area", () => {
    expect(nav).toMatch(/env\(safe-area-inset-bottom/);
  });
});

describe("user-written task text always wraps", () => {
  it("every render of task.description carries a wrap guard", () => {
    // A bare wallet address as a description is real, live data on the board.
    for (const file of ["Feed.tsx", "CampaignPage.tsx"]) {
      const src = read("src", "components", file);
      const lines = src.split("\n");
      const offenders = lines
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /\{(?:current)?[Tt]ask\.description\}/.test(line))
        .filter(({ line }) => !/break-words|break-all|truncate|line-clamp/.test(line));
      expect(offenders.map((o) => `${file}:${o.n}`), "unwrapped description render").toEqual([]);
    }
  });
});
