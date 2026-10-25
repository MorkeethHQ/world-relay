import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// HOW OFTEN DOES "SIGN IN AGAIN" COST A SIGNATURE (15 Oct 2026). PR 55 moved
// approve, chat, notifications and own-profile reads onto hard session gates.
// Three counters, no payload, once per device per UTC day each, read beside DAU
// on /api/stats/retention:
//   reauth_asked   a signature was asked because this wallet had no session
//   reauth_ok      the signature set a fresh session
//   reauth_failed  declined, another wallet, or the exchange failed
// Kill line (queue FAVOUR.txt DEEP 1): asked over 25% of DAU for 3 days.

const tracked = vi.hoisted(() => [] as Array<{ event: string; data: any }>);
vi.mock("@/lib/track", () => ({
  trackEvent: async (event: string, data?: any) => { tracked.push({ event, data }); },
  trackReach: async () => {},
}));
const wallet = vi.hoisted(() => ({ result: null as any, installed: true }));
vi.mock("@worldcoin/minikit-js", () => ({
  MiniKit: { isInstalled: () => wallet.installed, walletAuth: async () => wallet.result },
}));

import { POST } from "@/app/api/track/route";
import { reauthWallet } from "@/lib/reauth";

const W = "0x" + "a".repeat(40);
const sent: string[] = [];
const store = new Map<string, string>();

beforeEach(() => {
  tracked.length = 0; sent.length = 0; store.clear(); wallet.installed = true;
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
    if (url === "/api/nonce") return new Response(JSON.stringify({ nonce: "servernonce12345678" }));
    if (url === "/api/track") { sent.push(JSON.parse(init.body).event); return new Response("{}"); }
    if (url === "/api/verify-identity") return new Response("{}", { status: wallet.result?.verifyStatus ?? 200 });
    return new Response("{}");
  }));
});

describe("the track route takes the three names, and nothing with them", () => {
  for (const event of ["reauth_asked", "reauth_ok", "reauth_failed"]) {
    it(event, async () => {
      const res = await POST(new Request("http://localhost/api/track", { method: "POST", body: JSON.stringify({ event, data: { wallet: W } }) }) as any);
      expect(res.status).toBe(200);
      expect(tracked).toEqual([{ event, data: {} }]);
    });
  }
});

describe("reauthWallet counts what happened, once per device per day", () => {
  it("a signature that sets a session: asked, then ok", async () => {
    wallet.result = { data: { address: W, signature: "s", message: "m" } };
    expect(await reauthWallet(W)).toBe(true);
    expect(sent).toEqual(["reauth_asked", "reauth_ok"]);
  });
  it("a declined signature: asked, then failed", async () => {
    wallet.result = { data: null };
    expect(await reauthWallet(W)).toBe(false);
    expect(sent).toEqual(["reauth_asked", "reauth_failed"]);
  });
  it("the second time today sends nothing", async () => {
    wallet.result = { data: { address: W, signature: "s", message: "m" } };
    await reauthWallet(W); await reauthWallet(W);
    expect(sent).toEqual(["reauth_asked", "reauth_ok"]);
  });
  it("outside World App nothing is asked, so nothing is counted", async () => {
    wallet.installed = false;
    expect(await reauthWallet(W)).toBe(false);
    expect(sent).toEqual([]);
  });
  it("no wallet goes with the counter", async () => {
    wallet.result = { data: { address: W, signature: "s", message: "m" } };
    await reauthWallet(W);
    const bodies = (fetch as any).mock.calls.filter((c: any[]) => c[0] === "/api/track").map((c: any[]) => c[1].body);
    for (const b of bodies) expect(b).not.toMatch(/0x[0-9a-f]{40}/i);
  });
});

describe("the home page's own signature path counts the same way", () => {
  it("page.tsx reauthSilently sends the three counters", () => {
    const home = readFileSync(`${process.cwd()}/src/app/page.tsx`, "utf8");
    const fn = home.slice(home.indexOf("const reauthSilently = async"), home.indexOf("const reauthSilently = async") + 2600);
    expect(fn).toMatch(/trackReauthOncePerDay\("reauth_asked"\)/);
    expect(fn).toMatch(/trackReauthOncePerDay\([^)]*"reauth_ok"/);
    expect(fn).toMatch(/trackReauthOncePerDay\([^)]*"reauth_failed"/);
  });
});
