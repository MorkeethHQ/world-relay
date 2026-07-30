/**
 * Store package must not re-sell retired user escrow to World reviewers.
 * Behavioral/string guards only — see STORE-SUBMISSION.md + public/*.svg.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..", "..");

function read(...parts: string[]) {
  return readFileSync(join(root, ...parts), "utf8");
}

/** Wrong legacy address that once appeared in STORE-SUBMISSION (never the live proxy). */
const WRONG_ESCROW = /0xc976e463b[Dd]209[Ee]09cb15a168[Aa]275890b872[Aa]{2}1[Ff]0/i;

const USER_ESCROW_PROMISE =
  /USDC (locked )?in escrow|deposits? USDC into (an )?on-chain escrow|USDC escrow contract|Funded with USDC|USDC released from escrow|USDC in escrow/i;

describe("store package — no-custody truth", () => {
  it("STORE-SUBMISSION.md does not advertise the wrong escrow address", () => {
    expect(read("STORE-SUBMISSION.md")).not.toMatch(WRONG_ESCROW);
  });

  it("STORE-SUBMISSION.md does not claim users/agents lock USDC in escrow", () => {
    const md = read("STORE-SUBMISSION.md");
    // Changelog may mention retirement; forbid product-pitch phrases that sell escrow as live.
    const pitch = md.split("## Changelog")[0] ?? md;
    expect(pitch).not.toMatch(USER_ESCROW_PROMISE);
    expect(pitch).toMatch(/FAVOUR/);
    expect(pitch).toMatch(/no custody|does not hold|does not take custody/i);
  });

  it("public store SVGs do not brand RELAY or sell USDC escrow", () => {
    const dir = join(root, "public");
    const svgs = readdirSync(dir).filter((f) => f.endsWith(".svg"));
    const offenders: string[] = [];
    for (const f of svgs) {
      const src = read("public", f);
      if (/RELAY FAVOURS|Message RELAY|Ask RELAY|RELAY Chat|>RELAY</.test(src)) {
        offenders.push(`${f}: RELAY brand`);
      }
      if (USER_ESCROW_PROMISE.test(src) || WRONG_ESCROW.test(src)) {
        offenders.push(`${f}: escrow promise / wrong address`);
      }
    }
    expect(offenders, offenders.join("; ")).toEqual([]);
  });
});
