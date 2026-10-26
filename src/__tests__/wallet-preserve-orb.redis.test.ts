import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getAddress } from "viem";

// Real Upstash REST client and an isolated local Redis server exercise SET NX,
// GETDEL, and the route's persisted record. Only the external wallet signature
// check is replaced; these tests do not claim a real person signed anything.
vi.mock("@worldcoin/minikit-js/siwe", () => ({
  parseSiweMessage: () => ({ domain: "favour.test", uri: "https://favour.test" }),
  verifySiweMessage: async () => ({ isValid: true }),
}));
vi.mock("@/lib/track", () => ({ trackVisitor: async () => {}, trackEvent: async () => {} }));
vi.mock("@/lib/referral", () => ({ attributeReferral: async () => {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "test" }));

import { getRedis } from "@/lib/redis";
import { GET as nonce } from "@/app/api/nonce/route";
import { POST as identity } from "@/app/api/verify-identity/route";
import { getUserVerificationLevel } from "@/lib/verification-tier";

const canonical = `0x${"a".repeat(40)}`;
const checksummed = getAddress(canonical);
const walletOnly = `0x${"b".repeat(40)}`;
const initialOrb = { nullifier: "human-nullifier-existing", verificationLevel: "orb", verifiedAt: "2026-10-01T00:00:00Z", orbDetectedAt: "2026-10-01T00:00:00Z" };

async function signIn(address: string, extra: Record<string, unknown> = {}) {
  const challenge = await nonce(new NextRequest("https://favour.test/api/nonce"));
  expect(challenge.status).toBe(200);
  const { nonce: value } = await challenge.json();
  return identity(new NextRequest("https://favour.test/api/verify-identity", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `favour_siwe_nonce=${value}` },
    body: JSON.stringify({ address, signature: "local-test-signature", message: "local-test-message", ...extra }),
  }));
}

describe.runIf(!!process.env.TEST_REDIS_REST_URL)("wallet sign-in against isolated Redis", () => {
  it("keeps an existing Orb record and its nullifier through wallet sign-in", async () => {
    const redis = getRedis()!;
    await redis.set(`verified:${canonical}`, JSON.stringify(initialOrb));
    const response = await signIn(canonical);
    expect(response.status).toBe(200);
    expect((await response.json()).verification_level).toBe("orb");
    expect(response.headers.get("set-cookie")).toContain("favour_session=");
    expect(await redis.get(`verified:${canonical}`)).toEqual(initialOrb);
    expect(await getUserVerificationLevel(canonical)).toBe("orb");
  });

  it("migrates a checksummed Orb record to the canonical key without downgrading", async () => {
    const redis = getRedis()!;
    await redis.del(`verified:${canonical}`);
    await redis.set(`verified:${checksummed}`, JSON.stringify(initialOrb));
    // The returning wallet may now arrive lowercase even if the old record did not.
    const response = await signIn(canonical);
    expect(response.status).toBe(200);
    expect((await response.json()).verification_level).toBe("orb");
    expect(await redis.get(`verified:${canonical}`)).toEqual(initialOrb);
    expect(await getUserVerificationLevel(canonical)).toBe("orb");
  });

  it("does not accept a claimed Orb level when only a wallet signed", async () => {
    const redis = getRedis()!;
    await redis.del(`verified:${walletOnly}`);
    const response = await signIn(walletOnly, { verificationLevel: "orb", nullifier: "fake-nullifier" });
    expect(response.status).toBe(200);
    expect((await response.json()).verification_level).toBe("wallet");
    const record = await redis.get<{ verificationLevel: string; nullifier: string }>(`verified:${walletOnly}`);
    expect(record?.verificationLevel).toBe("wallet");
    expect(record?.nullifier).toBe(walletOnly);
  });
});
