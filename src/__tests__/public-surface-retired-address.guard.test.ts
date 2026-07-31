/**
 * GUARD: the retired v1 escrow address never reaches a public surface again.
 *
 * Pre-submission review 2026-07-31, FAIL 3: /api/health and /api/escrow-stats
 * publicly served 0x274C38…9351 (the retired UUPS proxy) as the app's escrow,
 * and the task page linked it unlabeled. The current rail is FavourEscrowV2_1,
 * config-sourced from src/lib/escrow-v2.ts ONLY. These tests pin:
 *   - /api/health: service "favour", escrow = config address, no retired addr
 *   - /api/escrow-stats: labeled legacy, currentEscrow = config address,
 *     retired address absent from the public response (internal accounting
 *     may still read the old contract)
 *   - task page: legacy link labeled "(legacy contract, retired)"; v2 tasks
 *     resolve their pinned/config address
 *   - /terms + /privacy: carry the honest poster-funded escrow sentences
 *     (FAIL 1 of the same review)
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { escrowV2Address } from "@/lib/escrow-v2";

const RETIRED = /0x274C38eA9944f57D24A59fbEf558bba2264f9351/i;
const SRC = join(process.cwd(), "src");

// Stub the chain so escrow-stats never hits a real RPC in tests.
const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
  if (functionName === "taskCount") return BigInt(1);
  if (functionName === "balanceOf") return BigInt(0);
  if (functionName === "getTask")
    return {
      agent: "0x0000000000000000000000000000000000000001",
      claimant: "0x0000000000000000000000000000000000000000",
      description: "legacy task",
      bounty: BigInt(1_000_000),
      deadline: BigInt(0),
      status: 2,
    };
  throw new Error(`unexpected readContract: ${functionName}`);
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: () => ({ readContract }) };
});

describe("/api/health", () => {
  it("reports service 'favour' and the config-sourced current escrow only", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = await res.json();
    expect(body.service).toBe("favour");
    expect(body.escrow).toBe(escrowV2Address());
    expect(JSON.stringify(body)).not.toMatch(RETIRED);
  });
});

describe("/api/escrow-stats", () => {
  it("is labeled legacy, points at the current escrow, and never serves the retired address", async () => {
    const { GET } = await import("@/app/api/escrow-stats/route");
    const res = await GET();
    const body = await res.json();
    expect(body.error).toBeUndefined();
    expect(body.legacy).toBe(true);
    expect(body.currentEscrow).toBe(escrowV2Address());
    expect(body.taskCount).toBe(1);
    expect(JSON.stringify(body)).not.toMatch(RETIRED);
  });
});

describe("task page contract link", () => {
  const page = readFileSync(join(SRC, "app/task/[id]/page.tsx"), "utf8");

  it("labels the retired address as legacy and routes v2 tasks to their pinned/config address", () => {
    expect(page).toMatch(/\(legacy contract, retired\)/);
    expect(page).toMatch(/task\.escrowV2Address \|\| escrowV2Address\(\)/);
    // The retired literal may exist only as the clearly-named legacy constant.
    expect(page).toMatch(/LEGACY_ESCROW_ADDRESS = "0x274C38/);
    expect(page).not.toMatch(/\bconst ESCROW_ADDRESS\b/);
  });
});

describe("terms + privacy tell the escrow truth", () => {
  it("terms scopes the no-custody claim and discloses the poster-funded escrow", () => {
    const terms = readFileSync(join(SRC, "app/terms/page.tsx"), "utf8");
    expect(terms).toMatch(/for points and campaign rewards/);
    expect(terms).toMatch(/verified, immutable escrow\s+contract from your own wallet/);
    expect(terms).toMatch(/refunds to you after the deadline/);
  });

  it("privacy covers the current poster-funded escrow, not 'no new ones are created'", () => {
    const privacy = readFileSync(join(SRC, "app/privacy/page.tsx"), "utf8");
    expect(privacy).toMatch(/FavourEscrowV2_1/);
    expect(privacy).not.toMatch(/no new ones are created/);
  });
});
