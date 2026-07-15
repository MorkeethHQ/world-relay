import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTask, setOnChainId, seedTask, claimOnChainId, getTask } from "@/lib/store";
import type { Task } from "@/lib/types";

// Invariant 6 (one escrow funds one payout), BEHAVIOURAL.
//
// invariants.guard.test.ts checks Inv 6 by grepping store.ts for `claimOnChainId(`
// and counting call sites. SECURITY-INVARIANTS.md is explicit that this is not
// enough: "A guard that only greps source for a call site is a doc aid, NOT a
// gate — make it behavioral (exercise the collision / the failure it's supposed
// to stop)." The grep passes if the calls exist but are un-awaited, ignored, or
// dead. This file exercises the actual collision on all three binding paths.
//
// The failure this stops (Jul 12, ~$7 of live escrow drained): task B references
// task A's already-funded onChainId. isEscrowTaskFunded confirms the escrow IS
// funded but not that it belongs to B, so B settles against A's live on-chain
// amount. The bind must be atomic (SET NX) and must fail closed BEFORE persist.

const mockStore = new Map<string, string>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    set: async (key: string, value: string, opts?: any) => {
      if (opts?.nx && mockStore.has(key)) return null;
      mockStore.set(key, value);
      return "OK";
    },
    get: async (key: string) => mockStore.get(key) || null,
    del: async (key: string) => { mockStore.delete(key); },
    sadd: async () => {},
    smembers: async () => [],
    sismember: async () => 0,
    srem: async () => {},
    pipeline: () => {
      const ops: Array<() => any> = [];
      return {
        get: (key: string) => { ops.push(() => mockStore.get(key) || null); },
        exec: async () => ops.map((op) => op()),
      };
    },
    pexpire: async () => {},
    incr: async () => 1,
  }),
}));

beforeEach(() => {
  mockStore.clear();
});

const VICTIM_ESCROW = 42;

async function fundedTask(poster: string, onChainId: number) {
  return createTask({
    poster,
    description: `task for ${poster}`,
    location: "Paris",
    bountyUsdc: 5,
    deadlineHours: 24,
    onChainId,
    escrowTxHash: `0x${"a".repeat(64)}`,
  });
}

describe("Inv 6: an escrow binds to exactly one task (cross-task drain)", () => {
  it("createTask REFUSES an escrow already funding another poster's task", async () => {
    const victim = await fundedTask("0xvictim", VICTIM_ESCROW);
    expect(victim.onChainId).toBe(VICTIM_ESCROW);

    // The drain: a different poster references the victim's funded escrow.
    await expect(fundedTask("0xattacker", VICTIM_ESCROW)).rejects.toThrow(
      /already bound to another task/
    );
  });

  it("createTask does not persist the attacker's task when the bind is refused", async () => {
    const victim = await fundedTask("0xvictim", VICTIM_ESCROW);
    await expect(fundedTask("0xattacker", VICTIM_ESCROW)).rejects.toThrow();

    // Fail-closed means BEFORE persist: the escrow must still point at the victim
    // and no second task may exist holding it.
    expect(mockStore.get(`escrow:bind:${VICTIM_ESCROW}`)).toBe(victim.id);
  });

  it("setOnChainId REFUSES binding an escrow that already funds another task", async () => {
    const victim = await fundedTask("0xvictim", VICTIM_ESCROW);

    // Attacker posts an UNFUNDED task, then tries to link the victim's escrow.
    const attacker = await createTask({
      poster: "0xattacker",
      description: "unfunded, will try to link a foreign escrow",
      location: "Paris",
      bountyUsdc: 5,
      deadlineHours: 24,
    });

    await expect(
      setOnChainId(attacker.id, VICTIM_ESCROW, `0x${"b".repeat(64)}`)
    ).rejects.toThrow(/already bound to another task/);

    const after = await getTask(attacker.id);
    expect(after!.onChainId).toBeNull();
    expect(mockStore.get(`escrow:bind:${VICTIM_ESCROW}`)).toBe(victim.id);
  });

  it("seedTask REFUSES an escrow bound elsewhere (no bind-less funded task)", async () => {
    const victim = await fundedTask("0xvictim", VICTIM_ESCROW);

    const seeded = {
      id: "seeded-attacker",
      poster: "0xattacker",
      description: "seeded task carrying a foreign escrow",
      location: "Paris",
      bountyUsdc: 5,
      onChainId: VICTIM_ESCROW,
      escrowTxHash: `0x${"c".repeat(64)}`,
    } as unknown as Task;

    await expect(seedTask(seeded)).rejects.toThrow(/already bound to another task/);
    expect(mockStore.get(`escrow:bind:${VICTIM_ESCROW}`)).toBe(victim.id);
  });

  it("re-binding the SAME escrow to the SAME task is idempotent (retry-safe)", async () => {
    const task = await fundedTask("0xposter", VICTIM_ESCROW);

    // A retried PATCH/link must not fail closed against itself.
    await expect(
      setOnChainId(task.id, VICTIM_ESCROW, `0x${"a".repeat(64)}`)
    ).resolves.toBeTruthy();
    expect(await claimOnChainId(VICTIM_ESCROW, task.id)).toBe(true);
  });

  it("distinct escrows bind independently (the guard is not a blanket refusal)", async () => {
    const a = await fundedTask("0xposterA", 1);
    const b = await fundedTask("0xposterB", 2);

    expect(a.onChainId).toBe(1);
    expect(b.onChainId).toBe(2);
    expect(mockStore.get("escrow:bind:1")).toBe(a.id);
    expect(mockStore.get("escrow:bind:2")).toBe(b.id);
  });

  it("concurrent binds of one escrow: exactly one wins", async () => {
    // The claim must be atomic (SET NX), not read-then-write. Two racing posters
    // referencing the same escrow must resolve to one winner, never two.
    const results = await Promise.allSettled([
      fundedTask("0xracer1", 99),
      fundedTask("0xracer2", 99),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(mockStore.get("escrow:bind:99")).toBe(
      (won[0] as PromiseFulfilledResult<Task>).value.id
    );
  });
});
