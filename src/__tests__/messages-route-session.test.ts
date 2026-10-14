import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Task chat is between the poster and the claimant. Measured on production
// 2026-10-12 (hardening audit): GET /api/tasks/{id}/messages with no cookie
// answered 200 and the messages, for a task id taken from the public feed.
// POST took `sender` from the body and compared it only with the two public
// addresses, so anyone could write as either. Both are now behind the session.

vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/xmtp", () => ({ postUserMessage: async () => {} }));
vi.mock("@/lib/xmtp-commands", () => ({ processIncomingMessage: async () => null }));

const tasks: Record<string, any> = {};
vi.mock("@/lib/store", () => ({ getTask: async (id: string) => tasks[id] ?? null }));

const messages: Record<string, any[]> = {};
vi.mock("@/lib/messages", () => ({
  getMessages: async (id: string) => messages[id] ?? [],
  addMessage: async (id: string, sender: string, text: string) => {
    (messages[id] ||= []).push({ id: "m", taskId: id, sender, text, timestamp: "t" });
  },
}));

import { GET, POST } from "@/app/api/tasks/[id]/messages/route";
import { POST as COMMAND } from "@/app/api/tasks/[id]/command/route";
import { issueSessionToken, SESSION_COOKIE } from "@/lib/session";

const POSTER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CLAIMANT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const STRANGER = "0x1111111111111111111111111111111111111111";
const params = Promise.resolve({ id: "t1" });

function cookie(addr: string) {
  return { cookie: `${SESSION_COOKIE}=${issueSessionToken(addr, Date.now())}` };
}
const get = (as?: string) =>
  GET(new Request("http://localhost/api/tasks/t1/messages", { headers: as ? cookie(as) : {} }) as any, { params });
const post = (body: unknown, as?: string) =>
  POST(new Request("http://localhost/api/tasks/t1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", ...(as ? cookie(as) : {}) },
    body: JSON.stringify(body),
  }) as any, { params });
const command = (body: unknown, as?: string) =>
  COMMAND(new Request("http://localhost/api/tasks/t1/command", {
    method: "POST",
    headers: { "content-type": "application/json", ...(as ? cookie(as) : {}) },
    body: JSON.stringify(body),
  }) as any, { params });

const ENV_ENFORCE = process.env.SESSION_ENFORCE;
const ENV_SECRET = process.env.SESSION_SECRET;
beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret";
  process.env.SESSION_ENFORCE = "true";
  tasks.t1 = { id: "t1", poster: POSTER, claimant: CLAIMANT, status: "claimed" };
  messages.t1 = [{ id: "m1", taskId: "t1", sender: POSTER, text: "hi", timestamp: "t" }];
});
afterEach(() => {
  if (ENV_ENFORCE === undefined) delete process.env.SESSION_ENFORCE;
  else process.env.SESSION_ENFORCE = ENV_ENFORCE;
  if (ENV_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = ENV_SECRET;
});

describe("GET /api/tasks/[id]/messages", () => {
  it("answers 401 with no cookie", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect((await res.json()).messages).toBeUndefined();
  });

  it("gives a signed-in non-participant 200 and no message, never the human chat", async () => {
    // The task page shows the thread to every viewer (page.tsx fetchData has
    // no participant gate), so a 403 would blank a page that opened yesterday.
    // An empty list keeps the page; the bot part is private too (14 Oct review).
    messages.t1.push({ id: "m2", taskId: "t1", sender: "relay-bot", text: "briefing", timestamp: "t" });
    const res = await get(STRANGER);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ messages: [], participant: false });
  });

  it("answers 200 to the poster and to the claimant, and is never cached", async () => {
    const res = await get(POSTER.toUpperCase());
    expect(res.status).toBe(200);
    expect((await res.json()).messages).toHaveLength(1);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect((await get(CLAIMANT)).status).toBe(200);
  });

  it("keeps the same 404 for a missing task, before any session question", async () => {
    delete tasks.t1;
    expect((await get()).status).toBe(404);
  });

  // R2 finding 3, measured on production e1cd732 on 14 Oct: with the switch
  // off, a caller with NO cookie read the whole thread of any task (10 tasks of
  // private chat, 13 messages with a wallet as sender), and the bot briefing
  // named wallets in 29 messages. The thread is now for a signed-in participant
  // only, whatever the switch says.
  it("switch off: a caller with no cookie gets no message", async () => {
    delete process.env.SESSION_ENFORCE;
    const anon = await (await get()).json();
    expect(anon).toEqual({ messages: [], participant: false });
  });

  // Codex review of cc2b5d6, 14 Oct: the bot is not a public speaker. It echoes
  // the proof note and names people by a shortened wallet (lib/xmtp.ts).
  it("a non-participant reads nothing of a thread the bot wrote into, signed in or not", async () => {
    delete process.env.SESSION_ENFORCE;
    const short = (w: string) => `${w.slice(0, 6)}...${w.slice(-4)}`;
    messages.t1.push(
      { id: "m2", taskId: "t1", sender: "relay-bot", text: `New task posted by ${short(POSTER)}\nWater the plants`, timestamp: "t" },
      { id: "m3", taskId: "t1", sender: "relay-bot", text: `Claimed by ${short(CLAIMANT)}\nWater the plants`, timestamp: "t" },
      { id: "m4", taskId: "t1", sender: "relay-bot", text: `Proof submitted: "my door code is 4471"\nVerifying...`, timestamp: "t" },
      { id: "m5", taskId: "t1", sender: CLAIMANT, text: "on my way", timestamp: "t" },
    );
    for (const as of [undefined, STRANGER]) {
      const res = await get(as);
      expect(res.status).toBe(200);
      const text = await res.clone().text();
      expect(text).not.toContain("4471");
      expect(text).not.toContain(short(POSTER));
      expect(text).not.toContain(short(CLAIMANT));
      expect(text).not.toMatch(/0x[0-9a-fA-F]{4}/);
      expect(await res.json()).toEqual({ messages: [], participant: false });
    }
    // Both participants read the whole thread, exactly as stored.
    for (const who of [POSTER, CLAIMANT]) {
      const own = await (await get(who)).json();
      expect(own.messages).toEqual(messages.t1);
    }
  });
});

describe("POST /api/tasks/[id]/messages", () => {
  it("refuses a body sender with no session (403, the ownership gate)", async () => {
    const res = await post({ sender: POSTER, text: "as the poster" });
    expect(res.status).toBe(403);
    expect(messages.t1).toHaveLength(1);
  });

  it("refuses a session that does not match the claimed sender", async () => {
    expect((await post({ sender: POSTER, text: "x" }, STRANGER)).status).toBe(403);
    expect((await post({ sender: POSTER, text: "x" }, CLAIMANT)).status).toBe(403);
  });

  it("lets a participant write as themselves", async () => {
    const res = await post({ sender: CLAIMANT, text: "on my way" }, CLAIMANT);
    expect(res.status).toBe(200);
  });

  it("still refuses a non-participant even with their own valid session", async () => {
    expect((await post({ sender: STRANGER, text: "x" }, STRANGER)).status).toBe(403);
  });
});

// 14 Oct 2026: the gate above was ownershipError, which lets everything through
// while SESSION_ENFORCE is off (production today). The favour page sent the
// poster's message as the doer, and the server stored it. Now ownerRefusal,
// the hard gate post, claim and verify use: the switch does not matter.
describe("POST /api/tasks/[id]/messages with SESSION_ENFORCE off", () => {
  beforeEach(() => { delete process.env.SESSION_ENFORCE; });
  it("a party cannot send as the other party", async () => {
    expect((await post({ sender: POSTER, text: "as the poster" }, CLAIMANT)).status).toBe(403);
    expect((await post({ sender: CLAIMANT, text: "as the doer" }, POSTER)).status).toBe(403);
    expect(messages.t1.map((m) => m.text)).toEqual(["hi"]); // only the seeded one
  });
  it("no cookie cannot send as a party", async () => {
    expect((await post({ sender: POSTER, text: "x" })).status).toBe(403);
    expect(messages.t1.map((m) => m.text)).toEqual(["hi"]); // only the seeded one
  });
  it("a party still sends as themselves", async () => {
    expect((await post({ sender: POSTER, text: "thanks" }, POSTER)).status).toBe(200);
  });
});

describe("POST /api/tasks/[id]/command (same shape, same gate)", () => {
  it("refuses a body sender with no session", async () => {
    expect((await command({ sender: POSTER, message: "/status" })).status).toBe(403);
  });
  it("refuses a session for a different wallet", async () => {
    expect((await command({ sender: POSTER, message: "/status" }, CLAIMANT)).status).toBe(403);
  });
  it("lets the poster command as themselves", async () => {
    expect((await command({ sender: POSTER, message: "/status" }, POSTER)).status).toBe(200);
  });
});

// 14 Oct 2026: /command had the same soft gate. It writes the sender's message
// and can drive commands, so it gets the same hard gate.
describe("POST /api/tasks/[id]/command with SESSION_ENFORCE off", () => {
  beforeEach(() => { delete process.env.SESSION_ENFORCE; });
  it("a party cannot command as the other party", async () => {
    expect((await command({ sender: POSTER, message: "/status" }, CLAIMANT)).status).toBe(403);
    expect((await command({ sender: CLAIMANT, message: "/status" }, POSTER)).status).toBe(403);
    expect(messages.t1.map((m) => m.text)).toEqual(["hi"]); // only the seeded one
  });
  it("no cookie cannot command as a party", async () => {
    expect((await command({ sender: POSTER, message: "/status" })).status).toBe(403);
    expect(messages.t1.map((m) => m.text)).toEqual(["hi"]);
  });
  it("a party still commands as themselves", async () => {
    expect((await command({ sender: POSTER, message: "/status" }, POSTER)).status).toBe(200);
  });
});
