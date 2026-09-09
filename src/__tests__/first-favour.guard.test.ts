import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { requiresPhotoProof, proofRequirement, PROOF_DESTINATION } from "@/lib/proof-requirement";

// Oscar, 2026-09-09: the first screen sold the concept of a marketplace instead
// of showing one job worth doing. The cold screen now leads with ONE real open
// favour, and /f/[id] is the public request page for a single favour.
//
// These are the things that can silently regress:
//   1. the proof requirement drifting between the submit form and the surfaces
//      that promise it,
//   2. the lead card quietly becoming hardcoded, curated or re-ranked in a
//      component instead of following BOARD-RULES,
//   3. a stock photograph appearing where a proof has not been submitted,
//   4. the CSS naming a typeface the app never loads.

const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");
const firstFavour = read("components", "FirstFavour.tsx");
const proofSlot = read("components", "ProofSlot.tsx");
const requestPage = read("app", "f", "[id]", "page.tsx");
const landing = read("app", "page.tsx");
const onboarding = read("components", "Onboarding.tsx");
const feed = read("components", "Feed.tsx");
const globals = read("app", "globals.css");

describe("proof requirement has one source", () => {
  it("asks for a photograph exactly on the categories that need one", () => {
    for (const c of ["photo", "delivery", "errand", "check-in"]) {
      expect(requiresPhotoProof(c), `${c} needs a photo`).toBe(true);
      expect(proofRequirement(c).kind).toBe("photo");
    }
    for (const c of ["feedback", "review", "social", "custom"]) {
      expect(requiresPhotoProof(c), `${c} is answered in words`).toBe(false);
      expect(proofRequirement(c).kind).toBe("text");
    }
  });

  it("the submit form and the public surfaces read the same rule", () => {
    // Feed.tsx owned this rule as a private function, so no other surface could
    // ask. If it grows its own copy again, the promise and the gate can drift.
    expect(feed).toContain('from "@/lib/proof-requirement"');
    expect(feed).not.toMatch(/function tierRequiresPhoto\(/);
    expect(firstFavour).toContain("ProofSlot");
    expect(requestPage).toContain('from "@/lib/proof-requirement"');
  });

  it("states what happens to a proof without promising a payout", () => {
    expect(PROOF_DESTINATION).toMatch(/checked by AI/);
    expect(PROOF_DESTINATION).toMatch(/jury/);
  });
});

describe("the cold first screen leads with a real favour", () => {
  it("both signed-out surfaces render the lead favour", () => {
    expect(landing).toContain("<FirstFavour");
    expect(onboarding).toContain("<FirstFavour");
  });

  it("takes the board's own order and never re-ranks or curates it", () => {
    // BOARD-RULES.md + board-rank.ts own visibility and order. A component that
    // filtered by category or sorted its own way would be board logic inline,
    // which CLAUDE.md forbids.
    expect(firstFavour).toMatch(/\.find\(\(t\) => t\.status === "open"\)/);
    expect(firstFavour).not.toMatch(/\.sort\(/);
    // (the comment in the component names board-rank.ts on purpose; what is
    // banned is importing or calling it here.)
    expect(firstFavour).not.toMatch(/from "@\/lib\/board-rank"|rankBoard\(|curateBoard\(/);
    expect(firstFavour).not.toMatch(/category === /);
  });

  it("has an honest state for an empty board and for a failed request", () => {
    expect(firstFavour).toContain("No favour is open at this moment.");
    expect(firstFavour).toContain("We could not load an open favour just now.");
    // The empty state must not be dressed as a favour.
    expect(firstFavour).toMatch(/no sample favour here/i);
  });
});

describe("nothing invents evidence or motion", () => {
  it("keeps stock art off the lead card and the request page", () => {
    for (const [name, src] of [["FirstFavour", firstFavour], ["ProofSlot", proofSlot], ["/f/[id]", requestPage]] as const) {
      expect(src, `${name} must not use stock art`).not.toMatch(/\/hero\//);
      expect(src, `${name} must not use the banned palette`).not.toMatch(/\b(?:text|bg|border|from|via|to)-(?:blue|indigo|violet|purple|cyan|sky)-\d/);
      expect(src, `${name} must not use info-*`).not.toMatch(/info-\d/);
    }
  });

  it("never animates the proof slot", () => {
    // A pulsing status dot is a tell, and FAVOUR shipped one once already.
    expect(proofSlot).not.toMatch(/animate-|animation:|transition-/);
  });

  it("reward amounts come from reward.ts, never hand-built", () => {
    expect(requestPage).toContain("rewardAmountLabel");
    expect(firstFavour).toContain("RewardBadge");
    // No hand-typed unit next to a number in either surface.
    expect(requestPage).not.toMatch(/\{[^}]*bountyUsdc[^}]*\}\s*pts/);
    expect(firstFavour).not.toMatch(/bountyUsdc/);
  });

  it("never paints points in money green on the request page", () => {
    const decl = requestPage.slice(requestPage.indexOf("const amountColour"));
    const expr = decl.slice(0, decl.indexOf(";"));
    expect(expr).toContain("points");
    expect(expr).toContain("text-amber-600");
    expect(expr).toContain("text-gray-400");
    expect(expr.indexOf("text-amber-600")).toBeLessThan(expr.indexOf("text-success-600"));
  });
});

describe("the app never names a typeface it does not load", () => {
  it("every custom family declared in src is backed by a real @font-face", () => {
    // 2026-09-09. The reported defect was that globals.css names "TWK Lausanne"
    // behind an undefined var(--font-sans) with no @font-face and no next/font
    // anywhere in src/, so the app supposedly rendered in -apple-system while
    // claiming a face it never shipped.
    //
    // Probed instead of believed: @worldcoin/mini-apps-ui-kit-react ships six
    // @font-face rules for TWK Lausanne and defines --font-sans at :root, and
    // globals.css imports that stylesheet on line 1. In a real Chromium the
    // three weights report status "loaded", and the same string measures
    // 399.17px against 348.81px for the fallback (identical to a nonexistent
    // family). The face is real. The claim was about the wrong object: src/.
    //
    // So the rule is not "no custom faces". It is: a family named in our CSS
    // must have an @font-face in CSS THE APP ACTUALLY LOADS , ours or an
    // imported package's. That still catches the failure the report feared.
    const css = globals.replace(/\/\*[\s\S]*?\*\//g, "");

    const loadedFaceCss = [css];
    for (const imp of css.match(/@import\s+"([^"]+)"/g) ?? []) {
      const spec = imp.match(/"([^"]+)"/)![1];
      if (spec.startsWith(".")) continue;
      // Resolve the package stylesheet the same way the bundler does.
      const pkg = spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");
      const base = join(__dirname, "..", "..", "node_modules", pkg);
      for (const candidate of ["dist/globals.css", "dist/styles.css", "styles.css"]) {
        try {
          loadedFaceCss.push(readFileSync(join(base, candidate), "utf8"));
        } catch {}
      }
    }
    const allCss = loadedFaceCss.join("\n");
    const usesNextFont = walk(join(__dirname, "..")).some((f) =>
      /from "next\/font/.test(readFileSync(f, "utf8")),
    );

    // Our own declarations, PLUS whatever --font-sans resolves to: the app
    // renders through that variable, so the families it names are the families
    // the app actually asks for, wherever they are defined.
    const declared = [
      ...(css.match(/font-family:\s*([^;]+);/g) ?? []),
      ...(allCss.match(/--font-sans:\s*([^;}]+)/g) ?? []),
    ];
    expect(declared.length, "no font-family declaration was read").toBeGreaterThan(0);
    let checked = 0;
    for (const d of declared) {
      const custom = (d.match(/"([^"]+)"/g) ?? [])
        .map((n) => n.replace(/"/g, ""))
        .filter((n) => !/^(system-ui|Segoe UI|Helvetica Neue|-apple-system|BlinkMacSystemFont|Roboto|Arial|sans-serif)$/i.test(n));
      for (const family of custom) {
        checked++;
        const hasFace = new RegExp(`@font-face[\\s\\S]{0,400}?font-family:\\s*"?${family}"?`, "i").test(allCss);
        expect(
          hasFace || usesNextFont,
          `${family} is named in globals.css but no @font-face in any loaded stylesheet defines it`,
        ).toBe(true);
      }
    }
    expect(checked, "no custom family was checked, so this guard proved nothing").toBeGreaterThan(0);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // Never read the test corpus: this guard mentions next/font in its own
    // prose, and walking itself made the check pass while the defect was live
    // (watched 2026-09-09, the break stayed green until this line existed).
    if (entry === "__tests__") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
