import { describe, it, expect, beforeEach, vi } from "vitest";

const mockStore = new Map<string, unknown>();
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (key: string) => mockStore.get(key) ?? null,
    set: async (key: string, value: string) => { mockStore.set(key, value); return "OK"; },
  }),
}));

let onChainOrb = false;
let lookups = 0;
vi.mock("@worldcoin/minikit-js/address-book", () => ({
  getIsUserVerified: async () => { lookups++; return onChainOrb; },
}));

import { getUserVerificationLevel } from "@/lib/verification-tier";

const WALLET = "0x" + "a".repeat(40);

beforeEach(() => {
  mockStore.clear();
  onChainOrb = false;
  lookups = 0;
});

describe("on-chain Orb detection (invariant 4: proven, not claimed)", () => {
  it("upgrades a wallet-tier user to orb when the Address Book says so, and persists it", async () => {
    mockStore.set(`verified:${WALLET}`, JSON.stringify({ nullifier: WALLET, verificationLevel: "wallet", verifiedAt: "2026-07-01" }));
    onChainOrb = true;
    expect(await getUserVerificationLevel(WALLET)).toBe("orb");
    // Persisted: second call reads the stored orb level, no new lookup.
    expect(await getUserVerificationLevel(WALLET)).toBe("orb");
    expect(lookups).toBe(1);
  });

  it("negative results are cached — no RPC per submission", async () => {
    mockStore.set(`verified:${WALLET}`, JSON.stringify({ verificationLevel: "wallet" }));
    expect(await getUserVerificationLevel(WALLET)).toBe("wallet");
    expect(await getUserVerificationLevel(WALLET)).toBe("wallet");
    expect(lookups).toBe(1);
  });

  it("non-wallet identities never hit the chain", async () => {
    expect(await getUserVerificationLevel("dev_alice")).toBe("wallet");
    expect(lookups).toBe(0);
  });

  it("a stored orb/device level is returned as-is without lookup", async () => {
    mockStore.set(`verified:${WALLET}`, JSON.stringify({ verificationLevel: "device" }));
    expect(await getUserVerificationLevel(WALLET)).toBe("device");
    expect(lookups).toBe(0);
  });
});
