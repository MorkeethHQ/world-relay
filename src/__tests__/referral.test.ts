import { describe, it, expect, beforeEach, vi } from "vitest";

const mockStore = new Map<string, unknown>();
const mockSets = new Map<string, Set<string>>();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (key: string) => mockStore.get(key) ?? null,
    set: async (key: string, value: string, opts?: { nx?: boolean }) => {
      if (opts?.nx && mockStore.has(key)) return null;
      mockStore.set(key, value);
      return "OK";
    },
    incr: async (key: string) => {
      const next = Number(mockStore.get(key) || 0) + 1;
      mockStore.set(key, next);
      return next;
    },
    sadd: async (key: string, member: string) => {
      const s = mockSets.get(key) || new Set<string>();
      s.add(member);
      mockSets.set(key, s);
      return 1;
    },
    smembers: async (key: string) => [...(mockSets.get(key) || [])],
  }),
}));

const awards: Array<{ address: string; action: string; points: number }> = [];
const profiles = new Map<string, { favoursCompleted: number }>();
vi.mock("@/lib/proof-of-favour", () => ({
  awardPoints: async (address: string, action: string, points: number) => {
    awards.push({ address, action, points });
    return {};
  },
  getProofOfFavour: async (address: string) => profiles.get(address) || { favoursCompleted: 0 },
}));

import {
  attributeReferral,
  recordReferralActivation,
  getReferralStats,
  REFERRAL_WELCOME_POINTS,
  REFERRAL_ACTIVATION_POINTS,
  REFERRAL_LIFETIME_CAP,
} from "@/lib/referral";

const REFERRER = "0x" + "1".repeat(40);
const INVITEE = "0x" + "2".repeat(40);

beforeEach(() => {
  mockStore.clear();
  mockSets.clear();
  profiles.clear();
  awards.length = 0;
});

describe("attribution", () => {
  it("attributes once, awards the invitee welcome points once", async () => {
    expect(await attributeReferral(INVITEE, REFERRER)).toBe(true);
    expect(await attributeReferral(INVITEE, REFERRER)).toBe(false);
    expect(await attributeReferral(INVITEE, "0x" + "3".repeat(40))).toBe(false);
    const welcome = awards.filter((a) => a.action === "referral_welcome");
    expect(welcome).toEqual([{ address: INVITEE, action: "referral_welcome", points: REFERRAL_WELCOME_POINTS }]);
  });

  it("blocks self-referral, non-wallet ids, and already-active users", async () => {
    expect(await attributeReferral(REFERRER, REFERRER)).toBe(false);
    expect(await attributeReferral("dev_alice", REFERRER)).toBe(false);
    expect(await attributeReferral(INVITEE, "agent:relay")).toBe(false);
    profiles.set(INVITEE, { favoursCompleted: 3 });
    expect(await attributeReferral(INVITEE, REFERRER)).toBe(false);
    expect(awards.length).toBe(0);
  });
});

describe("activation", () => {
  it("pays the referrer once, on the invitee's first clean completion only", async () => {
    await attributeReferral(INVITEE, REFERRER);
    expect(await recordReferralActivation(INVITEE)).toBe(true);
    expect(await recordReferralActivation(INVITEE)).toBe(false);
    const paid = awards.filter((a) => a.action === "referral_activated");
    expect(paid).toEqual([{ address: REFERRER, action: "referral_activated", points: REFERRAL_ACTIVATION_POINTS }]);
  });

  it("pays nothing for unattributed users", async () => {
    expect(await recordReferralActivation(INVITEE)).toBe(false);
    expect(awards.length).toBe(0);
  });

  it("stops paying at the lifetime cap but keeps counting", async () => {
    for (let i = 0; i < REFERRAL_LIFETIME_CAP + 3; i++) {
      const invitee = "0x" + String(i + 10).padStart(40, "0");
      await attributeReferral(invitee, REFERRER);
      await recordReferralActivation(invitee);
    }
    const paid = awards.filter((a) => a.action === "referral_activated");
    expect(paid.length).toBe(REFERRAL_LIFETIME_CAP);
    const stats = await getReferralStats(REFERRER);
    expect(stats.activated).toBe(REFERRAL_LIFETIME_CAP + 3);
    expect(stats.capReached).toBe(true);
    expect(stats.invited).toBe(REFERRAL_LIFETIME_CAP + 3);
  });
});
