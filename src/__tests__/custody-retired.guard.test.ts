import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  encodeCreateTask,
  encodeClaimTask,
  encodeReleasePayment,
  encodeUniswapSwap,
  SWAP_ENABLED,
} from "@/lib/contracts";
import { CUSTODY_RETIRED, custodyClosed } from "@/lib/custody";

/**
 * GUARD: FAVOUR does not take custody of anyone's money.
 *
 * Decided 2026-07-28 on measured data — `usdc_post_attempt` recorded ZERO in the
 * nine days it was live in prod, and 0 of 22 escrow-funded tasks ever came from
 * a real user — and forced by the World dev portal rejection "verify all
 * contracts", against an implementation whose source no longer exists behind a
 * proxy owned by the relayer hot wallet.
 *
 * `feedback_rules_not_vibes`: this is a live money app, so the rule is written
 * down and enforced in code rather than left to reviewer memory. The way IN is
 * closed at three independent layers, and each one is asserted here:
 *   1. the encoders cannot build a user transaction against a first-party contract
 *   2. the UI does not offer USDC as a reward or a way to fund a task
 *   3. the API refuses to record a task against the escrow, whatever it is sent
 *
 * Read-only escrow code is deliberately still present so the historical record
 * and the reconcile/expire crons keep working. Do not "clean that up" into a
 * working funding path.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("custody is retired", () => {
  it("declares the rule", () => {
    expect(CUSTODY_RETIRED).toBe(true);
    expect(custodyClosed()).toBe(true);
  });
});

describe("layer 1 — no user transaction against a first-party contract", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_ESCROW_ADDRESS", "0x274C38eA9944f57D24A59fbEf558bba2264f9351");
  });

  it("cannot encode a task-funding transaction", () => {
    expect(encodeCreateTask("do a favour", 5, 24)).toBeNull();
  });

  it("cannot encode a claim against the escrow", () => {
    expect(encodeClaimTask(1)).toBeNull();
  });

  it("cannot encode a release against the escrow", () => {
    expect(encodeReleasePayment(1)).toBeNull();
  });

  it("gates every escrow encoder, not just the ones tested above", () => {
    // A new encoder added without a gate would otherwise reopen the way in.
    const src = strip(read("src", "lib", "contracts.ts"));
    const escrowEncoders = [...src.matchAll(/export function (encode\w+)\([^)]*\)\s*\{([\s\S]*?)\n\}/g)]
      .filter(([, , body]) => /RELAY_ESCROW_ADDRESS|DOUBLE_OR_NOTHING_ADDRESS/.test(body));
    expect(escrowEncoders.length, "expected escrow encoders to exist").toBeGreaterThan(0);
    const ungated = escrowEncoders
      .filter(([, , body]) => !/custodyClosed\(\)/.test(body))
      .map(([, name]) => name);
    expect(ungated, "escrow encoder with no custody gate").toEqual([]);
  });
});

describe("layer 2 — the UI offers no way in", () => {
  const feed = read("src", "components", "Feed.tsx");

  it("does not offer USDC as a reward type", () => {
    // The picker may still exist in the source, but only behind the flag.
    const picker = feed.match(/setRewardType\("usdc"\)/);
    if (picker) {
      expect(feed).toMatch(/\{!CUSTODY_RETIRED && \(\s*<div>\s*<Typography[^>]*>Reward type/);
    }
  });

  it("does not render a fund-with-USDC button", () => {
    expect(feed).toMatch(/\{!CUSTODY_RETIRED && currentTask\.status === "open"/);
  });

  it("defaults the post wizard to points", () => {
    expect(feed).toMatch(/useState<"usdc" \| "points">\("points"\)/);
  });
});

describe("layer 3 — the API refuses to record new custody", () => {
  it("rejects a money favour outright rather than converting it to points", () => {
    // Silent conversion would misrepresent the poster's request AND bypass the
    // 1-10 points cap that bounds points inflation.
    const src = strip(read("src", "app", "api", "tasks", "route.ts"));
    expect(src).toMatch(/CUSTODY_RETIRED && rewardType !== "points"[\s\S]{0,220}status: 400/);
    // ...and it must be rejected BEFORE the points cap, not after.
    expect(src.indexOf('CUSTODY_RETIRED && rewardType !== "points"'))
      .toBeLessThan(src.indexOf('rewardType === "points" && !isAdmin'));
  });

  it("drops any escrow reference sent to POST /api/tasks", () => {
    const src = strip(read("src", "app", "api", "tasks", "route.ts"));
    expect(src).toMatch(/const isUsdc = !CUSTODY_RETIRED/);
    expect(src).toMatch(/verifiedOnChainId[\s\S]{0,120}CUSTODY_RETIRED \? null/);
    expect(src).toMatch(/verifiedEscrowTxHash[\s\S]{0,80}CUSTODY_RETIRED \? null/);
  });

  it("closes the agent funding endpoint with 410, before auth", () => {
    const src = strip(read("src", "app", "api", "agent", "fund", "route.ts"));
    const post = src.slice(src.indexOf("export async function POST"));
    expect(post).toMatch(/CUSTODY_RETIRED/);
    expect(post).toMatch(/status: 410/);
    // Must short-circuit before the auth check, so the answer does not depend
    // on who is asking.
    expect(post.indexOf("CUSTODY_RETIRED")).toBeLessThan(post.indexOf("checkAgentAuth"));
  });
});

describe("what retirement must NOT have broken", () => {
  it("still pays real USDC through the campaign unlock", () => {
    // This is a direct ERC-20 transfer from the relayer, not custody. It is the
    // rail real users have actually been paid on, and it must survive.
    const src = read("src", "lib", "campaign-unlock.ts");
    expect(src).toMatch(/functionName: "transfer"/);
    expect(src).not.toMatch(/custodyClosed|CUSTODY_RETIRED/);
  });

  it("leaves points and predictions alone", () => {
    const predictions = read("src", "lib", "predictions.ts");
    expect(predictions).toMatch(/spendPoints/);
    expect(predictions).not.toMatch(/custodyClosed|CUSTODY_RETIRED/);
  });

  it("does not promise users a USDC route that no longer exists", () => {
    const src = read("src", "app", "api", "tasks", "route.ts");
    const promises = src
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /error: "/.test(line))
      .filter(({ line }) => /fund .*with USDC|fund the task with USDC/i.test(line));
    expect(promises.map((p) => `tasks/route.ts:${p.n}`), "user-facing copy offers retired custody").toEqual([]);
  });
});

describe("no surface still claims FAVOUR holds money", () => {
  // The World reviewer reads /terms and /privacy. Before this guard they both
  // still said bounties were "held in escrow", and /terms pointed at the escrow
  // contract by name — the exact thing the listing was rejected over.
  const SURFACES = [
    ["src", "app", "terms", "page.tsx"],
    ["src", "app", "privacy", "page.tsx"],
    ["src", "components", "Onboarding.tsx"],
  ];

  it("never says funds are held in escrow", () => {
    const offenders: string[] = [];
    for (const parts of SURFACES) {
      const src = strip(read(...parts));
      // Collapse JSX line wrapping before matching — the claim spans lines.
      const flat = src.replace(/\s+/g, " ");
      if (/held in\s+escrow|funded, held in escrow|bounties are held/i.test(flat)) {
        offenders.push(parts.join("/"));
      }
    }
    expect(offenders, "user-facing copy still claims custody").toEqual([]);
  });

  it("never quotes a fee taken from a bounty", () => {
    // There is no fee any more: nothing passes through a contract we control.
    const offenders: string[] = [];
    for (const parts of SURFACES) {
      const flat = strip(read(...parts)).replace(/\s+/g, " ");
      if (/fee of \d|\d% to FAVOUR|deducted from each bounty/i.test(flat)) {
        offenders.push(parts.join("/"));
      }
    }
    expect(offenders, "user-facing copy still quotes an escrow fee").toEqual([]);
  });

  it("states plainly that FAVOUR takes no custody", () => {
    for (const parts of [SURFACES[0], SURFACES[1]]) {
      const flat = strip(read(...parts)).replace(/\s+/g, " ");
      expect(flat, `${parts.join("/")} must state the no-custody position`).toMatch(
        /takes no custody|does not hold your money/i
      );
    }
  });
});

describe("no reachable action builds a transaction that cannot succeed", () => {
  it("the swap is disabled — its router is not a router on World Chain", () => {
    // 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45 is Uniswap's ETHEREUM MAINNET
    // SwapRouter02. On World Chain (480) that address holds 2,109 bytes with no
    // exactInputSingle selector, and it was never in Contract Entrypoints, so
    // World rejected the call as invalid_contract before it reached the chain.
    expect(SWAP_ENABLED).toBe(false);
    expect(encodeUniswapSwap(5, "WLD", "0x1101158041fd96f21cbcbb0e752a9a2303e6d70e")).toBeNull();
  });

  it("does not render a swap button a user could tap", () => {
    const feed = read("src", "components", "Feed.tsx");
    expect(feed).toMatch(/\{SWAP_ENABLED && currentTask\.status === "completed"/);
  });
});
