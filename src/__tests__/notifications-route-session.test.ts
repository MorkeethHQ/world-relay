import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A person's notifications are theirs. Measured on production 2026-10-12
// (hardening audit): GET /api/notifications?user={address} with no cookie
// answered 200 with 20 rows and unreadCount 50 for a claimant address taken
// from the public feed. POST /api/notifications/read took `user` from the
// body. Both are now behind the session. No client in src/ calls either route
// today (grep -rn "api/notifications" src, 0 hits outside tests), so nobody is
// locked out by the gate.

vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));

const rows: Record<string, any[]> = {};
const marked: string[] = [];
vi.mock("@/lib/notifications-store", () => ({
  getNotifications: async (user: string) => rows[user] ?? [],
  getUnreadCount: async (user: string) => (rows[user] ?? []).filter((n) => !n.read).length,
  markRead: async (user: string, id: string) => { marked.push(`${user}:${id}`); },
  markAllRead: async (user: string) => { marked.push(`${user}:all`); },
}));

import { GET } from "@/app/api/notifications/route";
import { POST } from "@/app/api/notifications/read/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";

const ME = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const THEM = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function cookie(addr: string) {
  return { cookie: `${SESSION_COOKIE}=${issueSessionToken(addr, Date.now())}` };
}
const get = (user: string, as?: string) =>
  GET(new Request(`http://localhost/api/notifications?user=${user}`, { headers: as ? cookie(as) : {} }) as any);
const read = (body: unknown, as?: string) =>
  POST(new Request("http://localhost/api/notifications/read", {
    method: "POST",
    headers: { "content-type": "application/json", ...(as ? cookie(as) : {}) },
    body: JSON.stringify(body),
  }) as any);

const ENV_ENFORCE = process.env.SESSION_ENFORCE;
const ENV_SECRET = process.env.SESSION_SECRET;
beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret";
  process.env.SESSION_ENFORCE = "true";
  rows[ME] = [{ id: "n1", userId: ME, read: false }];
  rows[THEM] = [{ id: "n2", userId: THEM, read: false }, { id: "n3", userId: THEM, read: true }];
  marked.length = 0;
});
afterEach(() => {
  if (ENV_ENFORCE === undefined) delete process.env.SESSION_ENFORCE;
  else process.env.SESSION_ENFORCE = ENV_ENFORCE;
  if (ENV_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = ENV_SECRET;
});

describe("GET /api/notifications", () => {
  it("answers 401 with no cookie", async () => {
    const res = await get(THEM);
    expect(res.status).toBe(401);
    expect((await res.json()).notifications).toBeUndefined();
  });

  it("answers 403 when the signed-in wallet asks for another wallet's rows", async () => {
    expect((await get(THEM, ME)).status).toBe(403);
  });

  it("answers 200 with the owner's own rows, never cached", async () => {
    const res = await get(THEM, THEM.toUpperCase());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications.map((n: any) => n.id)).toEqual(["n2", "n3"]);
    expect(body.unreadCount).toBe(1);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("ships dark: switch off, anonymous read passes, wrong wallet still refused", async () => {
    delete process.env.SESSION_ENFORCE;
    expect((await get(THEM)).status).toBe(200);
    expect((await get(THEM, ME)).status).toBe(403);
  });
});

describe("POST /api/notifications/read", () => {
  it("refuses a body user with no session", async () => {
    expect((await read({ user: THEM, all: true })).status).toBe(403);
    expect(marked).toEqual([]);
  });

  it("refuses a session for a different wallet", async () => {
    expect((await read({ user: THEM, notification_id: "n2" }, ME)).status).toBe(403);
    expect(marked).toEqual([]);
  });

  it("lets the owner mark their own", async () => {
    expect((await read({ user: THEM, notification_id: "n2" }, THEM)).status).toBe(200);
    expect(marked).toEqual([`${THEM}:n2`]);
  });
});
