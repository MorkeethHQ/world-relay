import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// ESCROW WALLETS, WITH THE REAL SESSION CODE (R2 finding 2, Codex asks of 14 Oct).
// escrow-v2-flow.guard.test.ts mocks lib/session. This file does not: the
// cookie is issued and read by the real code, so a forged or expired cookie is
// tested as it is in production. Funder and recipient are wallets of their own,
// different from poster and claimant, so a check that only knows the task's two
// people would fail here.

const chain = vi.hoisted(() => ({
  record: null as null | { funder: string; recipient: string; amount: bigint; deadline: bigint; status: number },
}));
vi.mock("@/lib/escrow-v2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/escrow-v2")>();
  return { ...actual, getEscrowV2Record: vi.fn(async () => chain.record) };
});
const tasks = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("@/lib/store", () => ({ getTask: async (id: string) => tasks.get(id), listTasks: async () => [...tasks.values()] }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/track", () => ({ trackEvent: async () => {} }));

import { GET, POST } from "@/app/api/escrow-v2/route";
import { SESSION_COOKIE, SESSION_TTL_MS, issueSessionToken } from "@/lib/session";
import { escrowV2Address } from "@/lib/escrow-v2";

const POSTER = "0x1000000000000000000000000000000000000a01";
const CLAIMANT = "0x2000000000000000000000000000000000000b02";
const FUNDER = "0x3000000000000000000000000000000000000c03";
const RECIPIENT = "0x4000000000000000000000000000000000000d04";
const STRANGER = "0x5000000000000000000000000000000000000e05";
const PEOPLE = [POSTER, CLAIMANT, FUNDER, RECIPIENT];
const CONTRACT = escrowV2Address();

// Cookies are built INSIDE a test, after beforeEach has set the key. Built at
// module load they were "favour_session=null" and proved nothing (Codex, 14 Oct).
const cookieFor = (w: string, issuedAt = Date.now()) => {
  const token = issueSessionToken(w, issuedAt);
  if (!token) throw new Error("no session key: a cookie built here would prove nothing");
  return `${SESSION_COOKIE}=${token}`;
};
const EXPIRED_ISSUED_AT = Date.now() - 2 * SESSION_TTL_MS;
const VIEWERS: Record<string, () => string | null> = {
  "signed out": () => null,
  "signed-in stranger": () => cookieFor(STRANGER),
  // The real token shape (base64url payload, a dot, a signature) with a signature made by a key the server does not hold.
  "forged cookie naming the poster": () => `${SESSION_COOKIE}=${Buffer.from(`${POSTER.toLowerCase()}.${Date.now() + SESSION_TTL_MS}`).toString("base64url")}.${createHmac("sha256", "not-the-server-key").update(`${POSTER.toLowerCase()}.${Date.now() + SESSION_TTL_MS}`).digest("base64url")}`,
  "expired cookie of the poster": () => cookieFor(POSTER, EXPIRED_ISSUED_AT),
};
const PARTIES: Record<string, string> = { poster: POSTER, claimant: CLAIMANT, funder: FUNDER, recipient: RECIPIENT };

const getReq = (taskId: string, cookie: string | null) =>
  new NextRequest(`http://localhost/api/escrow-v2?taskId=${taskId}`, { headers: cookie ? { cookie } : {} });
const postReq = (body: Record<string, unknown>, cookie: string | null) =>
  new NextRequest("http://localhost/api/escrow-v2", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

/** Every person's wallet that appears in the text, by name. The contract is not a person. */
const named = (text: string) => PEOPLE.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
const anyWallet = (text: string) => (text.match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? []).filter((w) => w.toLowerCase() !== CONTRACT.toLowerCase());

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ESCROW_V2_ENABLED", "1");
  vi.stubEnv("SESSION_SECRET", "test-secret-not-a-real-one");
  tasks.clear();
  tasks.set("task-1", { id: "task-1", poster: POSTER, claimant: CLAIMANT, status: "claimed", rewardType: "usdc-v2", bountyUsdc: 5, escrowV2Address: CONTRACT, escrowTxHash: "0x" + "ab".repeat(32) });
  // Funded, past its deadline, so prepare-refund answers with a payload.
  chain.record = { funder: FUNDER, recipient: RECIPIENT, amount: BigInt(5_000_000), deadline: BigInt(1), status: 1 };
});

describe("GET ?taskId with the real session", () => {
  for (const [who, cookie] of Object.entries(VIEWERS)) {
    it(`${who}: the state, and no wallet`, async () => {
      const res = await GET(getReq("task-1", cookie()));
      expect(res.status).toBe(200);
      const text = await res.clone().text();
      expect(named(text)).toEqual([]);
      expect(anyWallet(text)).toEqual([]);
      expect((await res.json()).record).toEqual({ amount: "5000000", deadline: "1", status: 1, refundable: true });
    });
  }
  for (const [who, wallet] of Object.entries(PARTIES)) {
    it(`${who}: both escrow wallets`, async () => {
      const body = await (await GET(getReq("task-1", cookieFor(wallet)))).json();
      expect(body.record).toMatchObject({ funder: FUNDER, recipient: RECIPIENT });
    });
  }
});

describe("prepare-refund with the real session", () => {
  for (const [who, cookie] of Object.entries(VIEWERS)) {
    it(`${who}: the payload, and no funder`, async () => {
      const res = await POST(postReq({ action: "prepare-refund", taskId: "task-1" }, cookie()));
      expect(res.status).toBe(200);
      const text = await res.clone().text();
      expect(named(text)).toEqual([]);
      const body = await res.json();
      expect(body.funder).toBeUndefined();
      expect(body.payload).toBeTruthy();
    });
  }
  for (const [who, wallet] of Object.entries(PARTIES)) {
    it(`${who}: the funder`, async () => {
      const body = await (await POST(postReq({ action: "prepare-refund", taskId: "task-1" }, cookieFor(wallet)))).json();
      expect(body.funder).toBe(FUNDER);
    });
  }
});

describe("the cookies above are what they say", () => {
  it("a cookie made the same way with the server key IS accepted, so the forged one fails on its signature alone", async () => {
    const { getAuthedAddress } = await import("@/lib/session");
    const exp = Date.now() + SESSION_TTL_MS;
    const real = `${Buffer.from(`${POSTER.toLowerCase()}.${exp}`).toString("base64url")}.${createHmac("sha256", "test-secret-not-a-real-one").update(`${POSTER.toLowerCase()}.${exp}`).digest("base64url")}`;
    const ask = (c: string) => getAuthedAddress(new NextRequest("http://localhost/", { headers: { cookie: c } }), Date.now());
    expect(ask(`${SESSION_COOKIE}=${real}`)).toBe(POSTER.toLowerCase());
    expect(ask(VIEWERS["forged cookie naming the poster"]()!)).toBeNull();
  });
  it("the stranger's cookie is a real session for a wallet that is not a party", async () => {
    const { getAuthedAddress } = await import("@/lib/session");
    const c = VIEWERS["signed-in stranger"]()!;
    expect(c).not.toContain("=null");
    expect(getAuthedAddress(new NextRequest("http://localhost/", { headers: { cookie: c } }), Date.now())).toBe(STRANGER.toLowerCase());
    expect(PEOPLE.map((w) => w.toLowerCase())).not.toContain(STRANGER.toLowerCase());
  });
  it("the expired cookie is refused for its age: the same cookie read before its end is accepted", async () => {
    const { getAuthedAddress } = await import("@/lib/session");
    const c = VIEWERS["expired cookie of the poster"]()!;
    expect(c).not.toContain("=null");
    const at = (ms: number) => getAuthedAddress(new NextRequest("http://localhost/", { headers: { cookie: c } }), ms);
    expect(at(EXPIRED_ISSUED_AT + 1000)).toBe(POSTER.toLowerCase());
    expect(at(Date.now())).toBeNull();
  });
});

describe("an error names nobody", () => {
  it("unknown task, not refundable yet, not a v2 task: no wallet in any answer", async () => {
    const answers: Response[] = [];
    answers.push(await GET(getReq("no-such-task", null)));
    answers.push(await POST(postReq({ action: "prepare-refund", taskId: "no-such-task" }, null)));
    chain.record = { funder: FUNDER, recipient: RECIPIENT, amount: BigInt(5_000_000), deadline: BigInt(9_999_999_999), status: 1 };
    answers.push(await POST(postReq({ action: "prepare-refund", taskId: "task-1" }, cookieFor(STRANGER))));
    tasks.set("task-2", { id: "task-2", poster: POSTER, claimant: CLAIMANT, status: "claimed", rewardType: "points" });
    answers.push(await POST(postReq({ action: "prepare-refund", taskId: "task-2" }, null)));
    expect(answers.slice(1).map((r) => r.status)).toEqual([404, 409, 400]);
    for (const r of answers) {
      const text = await r.text();
      expect(named(text), text).toEqual([]);
    }
  });
});
