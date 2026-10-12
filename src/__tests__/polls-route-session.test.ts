import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A poll vote is attributed to `userId` from the body and feeds the daily
// streak (recordDailyActivity), so it writes a user record. The route checked
// only that userId looked like a wallet, never that the caller held it. The
// create route trusts `creator` the same way. Both now run ownershipError.

vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
const activity: string[] = [];
vi.mock("@/lib/proof-of-favour", () => ({ recordDailyActivity: async (a: string) => { activity.push(a); } }));

const votes: string[] = [];
const created: string[] = [];
vi.mock("@/lib/polls-store", () => ({
  vote: async (id: string, userId: string, option: string) => {
    votes.push(`${id}:${userId}:${option}`);
    return { poll: { id, voters: { [userId]: option } }, error: null };
  },
  createPoll: async (p: any) => { created.push(p.creator); return { id: "p1", ...p, voters: {} }; },
  listPolls: async () => [],
}));

import { POST as VOTE } from "@/app/api/polls/[id]/vote/route";
import { POST as CREATE } from "@/app/api/polls/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";

const ME = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const THEM = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const params = Promise.resolve({ id: "p1" });

function cookie(addr: string) {
  return { cookie: `${SESSION_COOKIE}=${issueSessionToken(addr, Date.now())}` };
}
const vote = (body: unknown, as?: string) =>
  VOTE(new Request("http://localhost/api/polls/p1/vote", {
    method: "POST",
    headers: { "content-type": "application/json", ...(as ? cookie(as) : {}) },
    body: JSON.stringify(body),
  }) as any, { params });
const create = (body: unknown, as?: string) =>
  CREATE(new Request("http://localhost/api/polls", {
    method: "POST",
    headers: { "content-type": "application/json", ...(as ? cookie(as) : {}) },
    body: JSON.stringify(body),
  }) as any);

const ENV_ENFORCE = process.env.SESSION_ENFORCE;
const ENV_SECRET = process.env.SESSION_SECRET;
beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret";
  process.env.SESSION_ENFORCE = "true";
  votes.length = 0; created.length = 0; activity.length = 0;
});
afterEach(() => {
  if (ENV_ENFORCE === undefined) delete process.env.SESSION_ENFORCE;
  else process.env.SESSION_ENFORCE = ENV_ENFORCE;
  if (ENV_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = ENV_SECRET;
});

describe("POST /api/polls/[id]/vote", () => {
  it("refuses a vote as a wallet with no session (403) and records nothing", async () => {
    expect((await vote({ userId: THEM, option: "a" })).status).toBe(403);
    expect(votes).toEqual([]);
    expect(activity).toEqual([]);
  });

  it("refuses a session for a different wallet", async () => {
    expect((await vote({ userId: THEM, option: "a" }, ME)).status).toBe(403);
    expect(votes).toEqual([]);
  });

  it("counts the vote of the wallet that holds the session", async () => {
    const res = await vote({ userId: ME, option: "a" }, ME);
    expect(res.status).toBe(200);
    expect(votes).toEqual([`p1:${ME}:a`]);
    expect((await res.json()).poll.voters).toBeUndefined();
  });

  it("ships dark: with the switch off an anonymous vote still counts (current production behaviour)", async () => {
    // ownershipError only logs a mismatched cookie while the switch is off; it
    // does not refuse it. That is the existing contract for all nine write
    // routes on ownershipError and is left as it is here. The read gate
    // (readerRefusal) is stricter and refuses a mismatch regardless.
    delete process.env.SESSION_ENFORCE;
    expect((await vote({ userId: THEM, option: "a" })).status).toBe(200);
    expect((await vote({ userId: THEM, option: "a" }, ME)).status).toBe(200);
  });
});

describe("POST /api/polls (create)", () => {
  const body = { question: "q?", options: ["a", "b"], creator: THEM };
  it("refuses a creator with no session", async () => {
    expect((await create(body)).status).toBe(403);
    expect(created).toEqual([]);
  });
  it("refuses a session for a different wallet", async () => {
    expect((await create(body, ME)).status).toBe(403);
  });
  it("lets the wallet that holds the session create", async () => {
    expect((await create(body, THEM)).status).toBe(201);
    expect(created).toEqual([THEM]);
  });
});
