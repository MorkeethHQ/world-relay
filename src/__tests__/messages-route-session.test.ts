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

  it("gives a signed-in non-participant the relay-bot briefing only, never the human chat", async () => {
    // The task page shows the thread to every viewer (page.tsx fetchData has
    // no participant gate), so a 403 would blank a page that opened yesterday.
    messages.t1.push({ id: "m2", taskId: "t1", sender: "relay-bot", text: "briefing", timestamp: "t" });
    const res = await get(STRANGER);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.participant).toBe(false);
    expect(body.messages.map((m: any) => m.sender)).toEqual(["relay-bot"]);
    expect(JSON.stringify(body)).not.toContain('"hi"');
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
  it("switch off: a caller with no cookie gets the bot part only, never the people's chat", async () => {
    delete process.env.SESSION_ENFORCE;
    const anon = await (await get()).json();
    expect(anon.messages).toHaveLength(0);
    expect(anon.participant).toBe(false);
    const stranger = await (await get(STRANGER)).json();
    expect(stranger.messages).toHaveLength(0);
  });

  it("a non-participant never reads a wallet, even inside the bot briefing", async () => {
    delete process.env.SESSION_ENFORCE;
    messages.t1.push({ id: "m2", taskId: "t1", sender: "relay-bot", text: `New task posted by ${POSTER}\nWater the plants`, timestamp: "t" });
    for (const as of [undefined, STRANGER]) {
      const res = await get(as);
      const text = await res.clone().text();
      expect(text).not.toMatch(/0x[0-9a-fA-F]{40}/);
      const body = await res.json();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].text).toContain("Water the plants");
    }
    // A participant still reads the whole thread as it is stored.
    const own = await (await get(POSTER)).json();
    expect(own.messages).toHaveLength(2);
    expect(own.messages[1].text).toContain(POSTER);
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
