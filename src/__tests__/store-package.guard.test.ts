/**
 * Store package must not re-sell retired user escrow to World reviewers.
 * Behavioral/string guards only — see STORE-SUBMISSION.md + public/*.svg.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { escrowV2Address } from "@/lib/escrow-v2";

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

  it("STORE-SUBMISSION.md tells reviewers the current escrow truth, not the retired rail", () => {
    const md = read("STORE-SUBMISSION.md");
    const pitch = md.split("## Changelog")[0] ?? md;
    expect(pitch).toMatch(/FAVOUR/);
    expect(pitch).toMatch(/non-custodial/i);
    // The live poster-funded escrow must be declared with its verified address
    // (config-sourced — the literal's one home is src/lib/escrow-v2.ts)…
    expect(pitch).toMatch(/FavourEscrowV2_1/);
    expect(pitch.toLowerCase()).toContain(escrowV2Address().toLowerCase());
    expect(pitch).toMatch(/0x000000000022D473030F116dDEE9F6B43aC78BA3/i); // Permit2 entrypoint
    expect(pitch).toMatch(/0x79A02482A880bCE3F13e09Da970dC34db4CD24d1/i); // Permit2 token: USDC
    // …and the retired address / stale instructions must be gone.
    expect(md).not.toMatch(/0x274C38eA9944f57D24A59fbEf558bba2264f9351/i);
    expect(md).not.toMatch(/Do not list or require verification/i);
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
