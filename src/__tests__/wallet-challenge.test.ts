import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const effect = vi.hoisted(() => ({ rows: new Map<string, unknown>(), available: true, signatureValid: true, failWrites: false }));
vi.mock("@/lib/redis", () => ({ getRedis: () => effect.available ? {
  get: async (k: string) => effect.rows.get(k) ?? null,
  getdel: async (k: string) => { const v = effect.rows.get(k) ?? null; effect.rows.delete(k); return v; },
  set: async (k: string, v: unknown) => { if (effect.failWrites) throw Error("offline"); effect.rows.set(k,v); return "OK"; },
} : null }));
vi.mock("@/lib/track", () => ({ trackVisitor: async () => {}, trackEvent: async () => {} }));
vi.mock("@/lib/referral", () => ({ attributeReferral: async () => {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: async () => ({ ok: true }), getClientIp: () => "test" }));
// Crypto RPC is the external effect. Challenge/cookie/replay/storage logic runs unchanged.
vi.mock("@worldcoin/minikit-js/siwe", () => ({
  parseSiweMessage: (m: string) => ({ domain: m === "wrong-domain" ? "other.test" : "favour.test", uri: "https://favour.test" }),
  verifySiweMessage: async () => ({ isValid: effect.signatureValid }),
}));
import { GET as nonce } from "@/app/api/nonce/route";
import { POST as identity } from "@/app/api/verify-identity/route";
const wallet = "0x" + "a".repeat(40);
function req(body: unknown, challenge?: string) { return new NextRequest("https://favour.test/api/verify-identity", { method: "POST", headers: { "Content-Type": "application/json", ...(challenge ? { Cookie: `favour_siwe_nonce=${challenge}` } : {}) }, body: JSON.stringify(body) }); }
async function challenge() { const r = await nonce(new NextRequest("https://favour.test/api/nonce")); expect(r.status).toBe(200); expect(r.headers.get("set-cookie")).toContain("HttpOnly"); return (await r.json()).nonce; }
beforeEach(() => { effect.rows.clear(); effect.available=true; effect.signatureValid=true; effect.failWrites=false; vi.stubEnv("SESSION_SECRET", "local-test-only"); });
describe("wallet authentication before any verified record/session", () => {
  it("refuses without persistent storage", async () => { effect.available=false; expect((await nonce(new NextRequest("https://favour.test/api/nonce"))).status).toBe(503); expect((await identity(req({ address: wallet, signature: "s", message: "m" }))).status).toBe(503); });
  it("refuses client-only challenges without writing verified identity", async () => { const r = await identity(req({ address: wallet, signature: "s", message: "m" }, "clientnonce")); expect(r.status).toBe(401); expect(effect.rows.has(`verified:${wallet}`)).toBe(false); expect(r.headers.get("set-cookie")).toBeNull(); });
  it("refuses bad signatures and wrong domains without writing identity", async () => { const n=await challenge(); effect.signatureValid=false; expect((await identity(req({address:wallet,signature:"s",message:"m"},n))).status).toBe(401); effect.signatureValid=true; expect((await identity(req({address:wallet,signature:"s",message:"wrong-domain"},n))).status).toBe(401); expect(effect.rows.has(`verified:${wallet}`)).toBe(false); });
  it("saves verified identity before issuing session and atomically refuses replay", async () => { const n=await challenge(); const payload={address:wallet,signature:"s",message:"m"}; const r=await identity(req(payload,n)); expect(r.status).toBe(200); expect(effect.rows.has(`verified:${wallet}`)).toBe(true); expect(r.headers.get("set-cookie")).toContain("favour_session="); expect((await identity(req(payload,n))).status).toBe(401); });
  it("never reports verified after storage failure", async () => { const n=await challenge(); effect.failWrites=true; const r=await identity(req({address:wallet,signature:"s",message:"m"},n)); expect(r.status).not.toBe(200); expect(r.headers.get("set-cookie")).toBeNull(); });
  it("refuses World ID as a wallet login substitute", async () => { expect((await identity(req({ rp_id: "untrusted-rp", idkitResponse: {}, address: wallet }))).status).toBe(403); });
});
