import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// readerRefusal is the READ half of the identity gate. ownershipError covers a
// write that names the wallet it acts as; a private read names nobody, so the
// gate has to answer from the cookie alone: 401 when there is no session, 403
// when the session is a wallet the record does not belong to, null for an
// owner. It honours SESSION_ENFORCE the same way ownershipError does, so it
// ships dark and is turned on with the writes.

const tracked: Array<{ name: string; props: Record<string, unknown> }> = [];
vi.mock("@/lib/track", () => ({
  trackEvent: async (name: string, props: Record<string, unknown>) => {
    tracked.push({ name, props });
  },
}));

import { readerRefusal, issueSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session";
import type { NextRequest } from "next/server";

const OWNER = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";
const PEER = "0x2222222222222222222222222222222222222222";
const OTHER = "0x1111111111111111111111111111111111111111";
const NOW = Date.parse("2026-10-13T00:00:00.000Z");

function req(cookie?: string, path = "/api/tasks/t1/messages"): NextRequest {
  return {
    cookies: { get: (n: string) => (n === SESSION_COOKIE && cookie ? { value: cookie } : undefined) },
    headers: { get: () => null },
    nextUrl: { pathname: path },
  } as unknown as NextRequest;
}

const ENV_ENFORCE = process.env.SESSION_ENFORCE;
const ENV_SECRET = process.env.SESSION_SECRET;
beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret";
  process.env.SESSION_ENFORCE = "true";
  tracked.length = 0;
});
afterEach(() => {
  if (ENV_ENFORCE === undefined) delete process.env.SESSION_ENFORCE;
  else process.env.SESSION_ENFORCE = ENV_ENFORCE;
  if (ENV_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = ENV_SECRET;
});

describe("readerRefusal when enforcing", () => {
  it("answers 401 to a caller with no session", () => {
    const r = readerRefusal(req(undefined), [OWNER, PEER], NOW);
    expect(r?.status).toBe(401);
    expect(r?.code).toBe("reauth_required");
  });

  it("answers 403 to a signed-in wallet that is not on the list", () => {
    const token = issueSessionToken(OTHER, NOW)!;
    const r = readerRefusal(req(token), [OWNER, PEER], NOW);
    expect(r?.status).toBe(403);
    expect(r?.code).toBe("forbidden");
  });

  it("lets an owner through, case-insensitively, and tells the caller who it is", () => {
    const token = issueSessionToken(OWNER.toUpperCase(), NOW)!;
    expect(readerRefusal(req(token), [OWNER.toLowerCase(), PEER], NOW)).toBeNull();
    const peer = issueSessionToken(PEER, NOW)!;
    expect(readerRefusal(req(peer), [OWNER, PEER], NOW)).toBeNull();
  });

  it("ignores null and non-wallet entries on the allowed list", () => {
    const token = issueSessionToken(OTHER, NOW)!;
    expect(readerRefusal(req(token), [OWNER, null, undefined, "agent:scout"], NOW)?.status).toBe(403);
  });

  it("treats an expired session as no session (401), never as an owner", () => {
    const token = issueSessionToken(OWNER, NOW)!;
    const later = NOW + SESSION_TTL_MS + 1000;
    expect(readerRefusal(req(token), [OWNER], later)?.status).toBe(401);
  });

  it("answers 401 when no signing secret is set, so a misconfigured flip is loud", () => {
    delete process.env.SESSION_SECRET;
    const prevAdmin = process.env.ADMIN_SECRET;
    delete process.env.ADMIN_SECRET;
    expect(readerRefusal(req("anything"), [OWNER], NOW)?.status).toBe(401);
    if (prevAdmin !== undefined) process.env.ADMIN_SECRET = prevAdmin;
  });
});

describe("readerRefusal while the switch is off", () => {
  it("lets an anonymous read through and counts it", () => {
    delete process.env.SESSION_ENFORCE;
    expect(readerRefusal(req(undefined), [OWNER], NOW)).toBeNull();
    expect(tracked.map((t) => t.name)).toEqual(["session_anon"]);
    expect(tracked[0].props.enforced).toBe(false);
    expect(tracked[0].props.path).toBe("/api/tasks/t1/messages");
  });

  it("still refuses a signed-in wallet reading another wallet's record (a definite spoof)", () => {
    delete process.env.SESSION_ENFORCE;
    const token = issueSessionToken(OTHER, NOW)!;
    expect(readerRefusal(req(token), [OWNER], NOW)?.status).toBe(403);
  });
});
