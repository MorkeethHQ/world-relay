import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { productColour } from "@/lib/product-colour";

describe("a product's colour on the featured screen", () => {
  it("refuses every colour that reads as money or as points", () => {
    // green-600, green-500, emerald, teal, cyan, lime, then amber-600, amber-700, yellow, orange
    for (const hex of ["#16a34a", "#22c55e", "#10b981", "#0d9488", "#14b8a6", "#06b6d4", "#84cc16", "#065f46",
      "#d97706", "#b45309", "#eab308", "#ea580c", "#c2410c", "#f59e0b", "#FC4C02"]) {
      expect(productColour(hex), hex).toBeNull();
    }
  });

  it("lets blue, purple, pink and red through, with readable text", () => {
    expect(productColour("#3b82f6")).toEqual({ fill: "#3b82f6", onFill: "ink" });
    expect(productColour("#5E6AD2")).toEqual({ fill: "#5e6ad2", onFill: "white" });
    expect(productColour("#7c3aed")?.onFill).toBe("white");
    expect(productColour("#db2777")?.onFill).toBe("white");
    expect(productColour("#dc2626")?.onFill).toBe("white");
    expect(productColour("#f9a8d4")?.onFill).toBe("ink");
  });

  it("lets a gray through whatever its hue: a gray carries neither meaning", () => {
    expect(productColour("#111827")?.onFill).toBe("white");
    expect(productColour("#0d0d0d")?.onFill).toBe("white");
    expect(productColour("#FAFAFA")?.onFill).toBe("ink");
    expect(productColour("#1a1c1a")).not.toBeNull(); // a faint green cast, far under the gray limit
    expect(productColour("#fff")).toEqual({ fill: "#ffffff", onFill: "ink" });
  });

  it("refuses anything that is not a plain hex colour", () => {
    for (const bad of ["green", "rgb(22,163,74)", "linear-gradient(#16a34a,#fff)", "#12345", "#16a34a; background:url(x)", "", null, 7]) {
      expect(productColour(bad), String(bad)).toBeNull();
    }
  });
});

// The same kind of source guard as design-system.guard.test.ts: for a palette
// rule the source is the behaviour.
describe("FeaturedProduct takes its colour through the one door", () => {
  const src = readFileSync(join(__dirname, "..", "components", "FeaturedProduct.tsx"), "utf8");
  const css = readFileSync(join(__dirname, "..", "components", "FeaturedProduct.module.css"), "utf8");

  it("fills only from productColour, never from a raw colour", () => {
    expect(src).toMatch(/productColour\(colour\)/);
    expect(src).not.toMatch(/accentColor|heroGradient/);
    expect(src).not.toMatch(/backgroundColor:\s*colour\b/);
    expect(src + css).not.toMatch(/gradient/i);
  });

  it("keeps green for funded money alone and uses no amber or banned palette class", () => {
    expect(src.match(/success-\d+/g)).toEqual(["success-600"]);
    expect(src).toMatch(/budget\.funded[\s\S]{0,200}text-success-600/);
    expect(src).not.toMatch(/\b(green|emerald|teal|lime|amber|yellow|orange|blue|indigo|violet|purple|cyan|sky)-\d/);
    expect(src).not.toMatch(/info-\d/);
  });
});
