import { describe, it, expect, afterEach, vi } from "vitest";

// trackEvent is fire-and-forget inside ownershipError; stub it so these tests
// assert the gate rather than the analytics write.
const tracked: Array<{ name: string; props: Record<string, unknown> }> = [];
vi.mock("@/lib/track", () => ({
  trackEvent: async (name: string, props: Record<string, unknown>) => {
    tracked.push({ name, props });
  },
}));

import {
  sessionEnforced,
  ownershipError,
  issueSessionToken,
  verifySessionToken,
  addressMatches,
  SESSION_COOKIE,
} from "@/lib/session";
import type { NextRequest } from "next/server";

const WALLET = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";
const OTHER = "0x1111111111111111111111111111111111111111";
const NOW = Date.parse("2026-09-16T10:00:00.000Z");

// A minimal NextRequest stand-in carrying only what ownershipError reads.
function req(cookie?: string, path = "/api/jury"): NextRequest {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE && cookie ? { value: cookie } : undefined) },
    nextUrl: { pathname: path },
  } as unknown as NextRequest;
}

const ENV_ENFORCE = process.env.SESSION_ENFORCE;
const ENV_SECRET = process.env.SESSION_SECRET;
afterEach(() => {
  if (ENV_ENFORCE === undefined) delete process.env.SESSION_ENFORCE;
  else process.env.SESSION_ENFORCE = ENV_ENFORCE;
  if (ENV_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = ENV_SECRET;
  tracked.length = 0;
});

describe("SESSION_ENFORCE parsing is typo-proof", () => {
  it("is off when the variable is absent", () => {
    delete process.env.SESSION_ENFORCE;
    expect(sessionEnforced()).toBe(false);
  });

  it("only the exact string 'true' enables it", () => {
    // A switch that turns on by typo is not a switch. The mirror of this test
    // lives in board-replenish.test.ts, where the safe default points the other
    // way: that one must not turn ON by accident, this one must not be believed
    // to be ON when it is not.
    for (const v of ["1", "yes", "TRUE", "True", "on", "", "false"]) {
      process.env.SESSION_ENFORCE = v;
      expect(sessionEnforced(), `value ${JSON.stringify(v)}`).toBe(false);
    }
    process.env.SESSION_ENFORCE = "true";
    expect(sessionEnforced()).toBe(true);
  });
});

describe("the gate refuses explicitly when enforcing", () => {
  it("refuses an unauthenticated caller with a reason, not a silent pass", () => {
    process.env.SESSION_SECRET = "test-secret";
    process.env.SESSION_ENFORCE = "true";
    const err = ownershipError(req(undefined), WALLET, NOW);
    expect(err).toBeTruthy();
    expect(err).toMatch(/re-authenticate/i);
  });

  it("refuses a caller acting as a wallet that is not theirs", () => {
    process.env.SESSION_SECRET = "test-secret";
    process.env.SESSION_ENFORCE = "true";
    const token = issueSessionToken(WALLET, NOW)!;
    const err = ownershipError(req(token), OTHER, NOW);
    expect(err).toMatch(/does not match/i);
  });

  it("allows the wallet that actually holds the session, case-insensitively", () => {
    process.env.SESSION_SECRET = "test-secret";
    process.env.SESSION_ENFORCE = "true";
    const token = issueSessionToken(WALLET, NOW)!;
    expect(ownershipError(req(token), WALLET.toUpperCase(), NOW)).toBeNull();
  });

  it("refuses an EXPIRED session rather than treating it as absent-and-fine", () => {
    process.env.SESSION_SECRET = "test-secret";
    process.env.SESSION_ENFORCE = "true";
    const token = issueSessionToken(WALLET, NOW)!;
    const eightDaysLater = NOW + 8 * 24 * 3600_000;
    expect(verifySessionToken(token, eightDaysLater)).toBeNull();
    expect(ownershipError(req(token), WALLET, eightDaysLater)).toMatch(/re-authenticate/i);
  });

  it("refuses when NO signing secret is configured, and does not silently pass", () => {
    // If neither SESSION_SECRET nor ADMIN_SECRET is set, secret() returns null,
    // no cookie can ever be minted and none can ever verify. Enforcing in that
    // state closes every gated route to everybody. This test exists so that
    // failure mode is a known, asserted property rather than an outage.
    delete process.env.SESSION_SECRET;
    const prevAdmin = process.env.ADMIN_SECRET;
    delete process.env.ADMIN_SECRET;
    process.env.SESSION_ENFORCE = "true";
    expect(issueSessionToken(WALLET, NOW)).toBeNull();
    expect(ownershipError(req("anything"), WALLET, NOW)).toMatch(/re-authenticate/i);
    if (prevAdmin !== undefined) process.env.ADMIN_SECRET = prevAdmin;
  });
});

describe("the permissive default is recorded, not hidden", () => {
  it("lets an unauthenticated caller through while the switch is off", () => {
    // This is the CURRENT PRODUCTION BEHAVIOUR and it is asserted deliberately.
    // Measured against production 2026-09-16: an unauthenticated POST /api/jury
    // claiming an arbitrary wallet returned 409, not 403. When this test starts
    // failing, the gate has been turned on, and that is the intended direction.
    process.env.SESSION_SECRET = "test-secret";
    delete process.env.SESSION_ENFORCE;
    expect(ownershipError(req(undefined), WALLET, NOW)).toBeNull();
  });

  it("still counts every call so the flip can be decided on a number", () => {
    process.env.SESSION_SECRET = "test-secret";
    delete process.env.SESSION_ENFORCE;
    tracked.length = 0;
    ownershipError(req(undefined), WALLET, NOW);
    const token = issueSessionToken(WALLET, NOW)!;
    ownershipError(req(token), WALLET, NOW);
    expect(tracked.map((t) => t.name)).toEqual(["session_anon", "session_authed"]);
    expect(tracked[0].props.path).toBe("/api/jury");
    expect(tracked[0].props.enforced).toBe(false);
  });
});

describe("addressMatches never lets a non-string through", () => {
  it("rejects undefined, null, numbers and objects", () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(addressMatches(WALLET.toLowerCase(), bad), String(bad)).toBe(false);
    }
  });
});
