import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// DESIGN-SYSTEM.md, section "Components", is the list of the components that may
// show a product. This guard reads that table, so the document and the code
// cannot drift apart silently (Oscar, 8 Oct 2026: strict rules on design,
// components and how flows work).
const ROOT = join(__dirname, "..", "..");
const doc = readFileSync(join(ROOT, "DESIGN-SYSTEM.md"), "utf8");
const section = doc.slice(doc.indexOf("## Components"), doc.indexOf("## Flows"));
const listed = [...section.matchAll(/^\| `([A-Za-z]+\.tsx)` \|/gm)].map((m) => m[1]);
const file = (name: string) => join(ROOT, "src", "components", name);

// The components built for the product surfaces. A new one goes in this list AND
// in the document's table; the test below fails when the two differ.
const PRODUCT_SURFACES = ["TopProducts.tsx", "ProductCampaignCard.tsx", "FeaturedProduct.tsx", "HunterCard.tsx", "PostYourApp.tsx", "TopProductsLive.tsx", "ProductScreen.tsx", "HunterCardLive.tsx", "Kit.tsx", "Hunt.tsx", "HuntLive.tsx", "TalkRooms.tsx", "TalkRoom.tsx", "TalkPicture.tsx", "TalkFace.tsx"];

describe("the component table in DESIGN-SYSTEM.md is the truth", () => {
  it("names only components that exist", () => {
    expect(listed.length).toBeGreaterThanOrEqual(6);
    for (const name of listed) expect(existsSync(file(name)), name).toBe(true);
  });

  it("names every product surface component", () => {
    for (const name of PRODUCT_SURFACES) expect(listed, name).toContain(name);
  });

  it("describes both flows and the tap limit", () => {
    expect(doc).toMatch(/Flow 1: review a product and get paid/);
    expect(doc).toMatch(/Flow 2: post your own app/);
    expect(doc).toMatch(/Four taps or fewer/);
  });
});

describe.each(PRODUCT_SURFACES)("%s obeys the rules for every component", (name) => {
  const src = readFileSync(file(name), "utf8");
  const cssPath = file(name.replace(".tsx", ".module.css"));
  const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";

  it("uses no banned palette and no amber except for points", () => {
    expect(src).not.toMatch(/info-\d|\b(blue|indigo|violet|purple|cyan|sky|teal|emerald|lime|green)-\d/);
    for (const m of src.matchAll(/.{0,80}amber-\d+.{0,40}/g)) expect(m[0], m[0]).toMatch(/pts|points/i);
  });

  it("keeps money green for a funded budget only", () => {
    for (const m of src.matchAll(/[\s\S]{0,200}success-\d+/g)) expect(m[0]).toMatch(/budget\.funded/);
  });

  it("does not pulse, bounce, blink or use a gradient", () => {
    expect(src).not.toMatch(/animate-(pulse|bounce|ping|spin)/);
    expect(src + css).not.toMatch(/gradient/i);
    const moving = (css.match(/@keyframes/g) || []).length;
    expect(moving).toBe(name === "ProductCampaignCard.tsx" ? 1 : 0); // the one slow capture
    if (moving) expect(css).toMatch(/prefers-reduced-motion/);
  });

  it("gives every button a 44px target", () => {
    for (const m of src.matchAll(/<button[\s\S]*?>/g)) expect(m[0], m[0]).toMatch(/min-h-\[(44|72)px\]/);
  });
});

// The kit is where every surface's buttons come from, so the kit's own buttons,
// pills and rows carry the target in their CSS too, and the kit knows no amber,
// no green and no keyframe at all.
describe("Kit.module.css holds the system", () => {
  const css = readFileSync(file("Kit.module.css"), "utf8");
  it("gives the primary button, the quiet pill and the row their minimum height", () => {
    expect(css).toMatch(/\.primary \{[^}]*min-height: 52px/);
    expect(css).toMatch(/\.quiet \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.row \{[^}]*min-height: 72px/);
    expect(css).toMatch(/\.field \{[^}]*font-size: 16px/); // the phone must not zoom
  });
  it("holds no colour that means points or money, and nothing that moves", () => {
    expect(css).not.toMatch(/#(d97706|f59e0b|b45309|16a34a|22c55e|15803d)|amber|green/i);
    expect(css).not.toMatch(/@keyframes|animation:|gradient|box-shadow/);
  });
});
