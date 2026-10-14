import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// TWO PRIVATE READS (14 Oct 2026, read-only audit of 14 Oct). With
// SESSION_ENFORCE off (production), a caller with no cookie could read:
//   GET /api/verify-identity?address=  the stored identity record, nullifier included
//   GET /api/notifications?user=       another person's notifications
// Every case below runs with the switch OFF.

const NULLIFIER = "0x" + "9".repeat(64);
const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

vi.mock("@/lib/track", () => ({ trackEvent: async () => {}, trackVisitor: async () => {} }));
vi.mock("@/lib/referral", () => ({ attributeReferral: async () => {} }));
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: async (k: string) => (k === `verified:${OWNER}` ? JSON.stringify({ nullifier: NULLIFIER, verificationLevel: "orb", verifiedAt: "2026-09-01T00:00:00Z" }) : null),
  }),
}));
const notes = vi.hoisted(() => ({ read: vi.fn(async () => [{ id: "n1", title: "Your proof was approved" }]) }));
vi.mock("@/lib/notifications-store", () => ({ getNotifications: notes.read, getUnreadCount: async () => 1 }));

import { GET as IDENTITY } from "@/app/api/verify-identity/route";
import { GET as NOTIFICATIONS } from "@/app/api/notifications/route";
import { SESSION_COOKIE, issueSessionToken } from "@/lib/session";

const get = (url: string, as?: string) => {
  const token = as ? issueSessionToken(as, Date.now()) : null;
  if (as && !token) throw new Error("no session key");
  return new NextRequest(`http://localhost${url}`, { headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {} });
};

const ENV = { ...process.env };
beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-not-a-real-one";
  delete process.env.SESSION_ENFORCE;
  notes.read.mockClear();
});
afterEach(() => { process.env = { ...ENV }; });

describe("GET /api/verify-identity?address=", () => {
  it("no cookie: whether verified and the level, never the nullifier", async () => {
    const res = await IDENTITY(get(`/api/verify-identity?address=${OWNER}`));
    const text = await res.text();
    expect(text).not.toContain(NULLIFIER);
    expect(JSON.parse(text)).toEqual({ verified: true, verification_level: "orb" });
  });
  it("another wallet's cookie: the same, never the nullifier", async () => {
    const text = await (await IDENTITY(get(`/api/verify-identity?address=${OWNER}`, OTHER))).text();
    expect(text).not.toContain(NULLIFIER);
  });
  it("the wallet's own cookie: the whole record", async () => {
    const body = await (await IDENTITY(get(`/api/verify-identity?address=${OWNER}`, OWNER))).json();
    expect(body).toMatchObject({ verified: true, nullifier: NULLIFIER });
  });
  it("an unknown wallet is still just not verified", async () => {
    expect(await (await IDENTITY(get(`/api/verify-identity?address=${OTHER}`))).json()).toEqual({ verified: false, verification_level: null });
  });
});

describe("GET /api/notifications?user=", () => {
  it("no cookie: refused, and nothing is read", async () => {
    const res = await NOTIFICATIONS(get(`/api/notifications?user=${OWNER}`));
    expect([401, 403]).toContain(res.status);
    expect(await res.text()).not.toContain("approved");
    expect(notes.read).not.toHaveBeenCalled();
  });
  it("another wallet's cookie: refused", async () => {
    expect((await NOTIFICATIONS(get(`/api/notifications?user=${OWNER}`, OTHER))).status).toBe(403);
    expect(notes.read).not.toHaveBeenCalled();
  });
  it("the owner's own cookie: the notifications", async () => {
    const res = await NOTIFICATIONS(get(`/api/notifications?user=${OWNER}`, OWNER));
    expect(res.status).toBe(200);
    expect((await res.json()).unreadCount).toBe(1);
  });
});
