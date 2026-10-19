import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// CODEX REVIEW OF THE STACK AT 5254745 (14 Oct 2026): three blockers, two minors.

const src = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");
const WALLET = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;

const store = vi.hoisted(() => ({ hang: false, sets: new Map<string, Set<string>>() }));
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    sadd: (k: string, m: string) => store.hang ? new Promise(() => {}) : Promise.resolve((store.sets.get(k) ?? store.sets.set(k, new Set()).get(k)!).add(m).size),
    expire: () => store.hang ? new Promise(() => {}) : Promise.resolve(1),
    smembers: async (k: string) => [...(store.sets.get(k) ?? [])],
  }),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => { throw new Error("outside a request"); } }));
vi.mock("@worldcoin/minikit-js", () => ({ MiniKit: { isInstalled: () => false } }));

import { excludedFromEnv, isOutside, noteCompleted, noteJuror } from "@/lib/north-star";
import { sendWithReauth } from "@/lib/reauth";

beforeEach(() => { store.hang = false; store.sets.clear(); });

describe("blocker 1: no wallet in source; the operator is excluded by env only", () => {
  it("north-star.ts and its read script name no wallet", () => {
    expect(src("src/lib/north-star.ts")).not.toMatch(WALLET);
    expect(src("scripts/north-star-read.mjs")).not.toMatch(WALLET);
  });
  it("any real wallet counts until NORTH_STAR_EXCLUDE names it", () => {
    const op = "0x" + "1".repeat(40);
    expect(isOutside(op, excludedFromEnv({}))).toBe(true);
    expect(isOutside(op, excludedFromEnv({ NORTH_STAR_EXCLUDE: op }))).toBe(false);
  });
});

describe("blocker 2: a counter write never blocks a verdict or a completion", () => {
  it("noteJuror and noteCompleted return at once while the store hangs", async () => {
    store.hang = true;
    const t0 = Date.now();
    expect(noteJuror("0x" + "2".repeat(40))).toBeUndefined();
    expect(noteCompleted("f1", "0x" + "2".repeat(40))).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(50);
  });
  it("the callers do not await them", () => {
    for (const f of ["src/lib/jury.ts", "src/lib/completions.ts", "src/lib/house-review.ts"]) {
      expect(src(f), f).not.toMatch(/await\s+note(Juror|Completed)\(/);
    }
  });
  it("each write has a deadline", () => {
    expect(src("src/lib/north-star.ts")).toMatch(/NOTE_DEADLINE_MS = \d+/);
  });
});

describe("minors: count after firstOnProof; house review completions count", () => {
  it("jury: the juror is counted only after a first verdict on this proof", () => {
    const j = src("src/lib/jury.ts");
    const fn = j.slice(j.indexOf("export async function recordJuryVerdict"));
    const repeatReturn = fn.indexOf("practice: true, repeat: true");
    expect(repeatReturn).toBeGreaterThan(0);
    expect(fn.indexOf("noteJuror(judge)")).toBeGreaterThan(repeatReturn);
  });
  it("house review: noteCompleted after its History row", () => {
    const h = src("src/lib/house-review.ts");
    const row = h.indexOf("await redis.eval(RECORD_HISTORY_ONCE");
    expect(row).toBeGreaterThan(0);
    expect(h.indexOf("noteCompleted(", row)).toBeGreaterThan(row);
  });
});

describe("blocker 3: a hard gate can be recovered from any page", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  it("sendWithReauth signs in once on reauth_required and sends again", async () => {
    const send = vi.fn().mockResolvedValueOnce(json(403, { code: "reauth_required" })).mockResolvedValueOnce(json(200, { ok: true }));
    const reauth = vi.fn(async () => true);
    expect((await sendWithReauth(send, "0xabc", reauth)).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(reauth).toHaveBeenCalledTimes(1);
  });
  it("no second send when sign-in fails, or when the refusal is not about the session", async () => {
    const send = vi.fn(async () => json(401, { code: "reauth_required" }));
    expect((await sendWithReauth(send, "0xabc", async () => false)).status).toBe(401);
    const other = vi.fn(async () => json(403, { code: "forbidden" }));
    const reauth = vi.fn(async () => true);
    await sendWithReauth(other, "0xabc", reauth);
    expect(other).toHaveBeenCalledTimes(1);
    expect(reauth).not.toHaveBeenCalled();
  });
  it("the favour page sends through sendWithReauth and keeps the draft when it fails", () => {
    const page = src("src/app/task/[id]/page.tsx");
    expect(page).toMatch(/sendWithReauth\(/);
    expect(page).toContain("onSend: (text: string) => Promise<boolean>;");
    expect(page).toMatch(/if \(!\(await onSend\(text\)\)\) setDraft\(text\);/);
  });
  it("the Profile card loads through sendWithReauth and offers a sign-in", () => {
    const card = src("src/components/ProofOfFavourCard.tsx");
    expect(card).toMatch(/sendWithReauth\(/);
    expect(card).toContain("Sign in again");
  });
});

// SECOND CODEX REVIEW (030631e) and FINAL PASS (c391018): the task API masks
// wallets for a viewer without a session, so the page may never compare or
// send task.poster. It asks the server (isOwnTask / isClaimant), sends as the
// viewer, and renews an expired session when it opens.
describe("review 2 and final: the favour page works from the session", () => {
  const page = () => src("src/app/task/[id]/page.tsx");
  it("approve and mediation send as the viewer, through sendWithReauth", () => {
    const p = page();
    const confirm = p.slice(p.indexOf("const handleConfirm = async"), p.indexOf("const handleConfirm = async") + 900);
    const mediate = p.slice(p.indexOf("const handleMediation = async"), p.indexOf("const handleMediation = async") + 900);
    expect(confirm).toMatch(/sendWithReauth\(\(\) => fetch\(`\/api\/tasks\/\$\{task\.id\}\/confirm`/);
    expect(confirm).toContain("body: JSON.stringify({ poster: viewer, approved }),");
    expect(confirm).toContain("}), viewer);");
    expect(mediate).toContain("body: JSON.stringify({ poster: viewer }),");
    expect(mediate).toContain("}), viewer);");
    expect(p).not.toMatch(/poster: task\.poster/);
  });
  it("the page renews an expired session on open and reads again", () => {
    expect(page()).toMatch(/ensureSession\(userId\)\.then\(\(ok\) => \{ if \(ok\) fetchDataRef\.current\?\.\(\); \}\)/);
  });
  it("who is a party comes from the server's flags, never a wallet compare", () => {
    const p = page();
    expect(p).toContain("userId={isParty(task) ? userId : null}");
    expect(p).not.toMatch(/\[task\.poster, task\.claimant\]\.some\(/);
  });
  it("the Profile renews the session first and reads only its own rows", () => {
    // 19 Oct 2026: /dashboard mounts components/fv/ProfileScreen.tsx.
    const d = src("src/components/fv/ProfileScreen.tsx");
    expect(d).toMatch(/ensureSession\(/);
    expect(d).not.toMatch(/t\.poster === userId|t\.claimant === userId/);
  });
  it("Feed and CompanyCampaign start recovery on 401 too", () => {
    for (const f of ["src/components/Feed.tsx", "src/components/CompanyCampaign.tsx"]) {
      expect(src(f), f).not.toMatch(/res\.status === 403 && onReauth/);
    }
    expect(src("src/components/Feed.tsx")).not.toContain("if (res.status !== 403 || !onReauth) return res;");
  });
});

describe("review 2 minors", () => {
  it("the Profile reads nothing by ?address= (referral stats left the Profile on 19 Oct 2026)", () => {
    expect(src("src/components/fv/ProfileScreen.tsx")).not.toMatch(/\?address=/);
  });
  it("house review counts only when its History script wrote the row", () => {
    const h = src("src/lib/house-review.ts");
    expect(h).toMatch(/const wroteRow = await redis\.eval\(RECORD_HISTORY_ONCE/);
    expect(h).toMatch(/if \(Number\(wroteRow\) === 1\) noteCompleted\(/);
  });
});

// CODEX MERGE VERDICT on cf26146, one minor: ensureSession accepted any
// session, also another wallet's. It must belong to the wallet asked for.
describe("ensureSession accepts only this wallet's session", () => {
  const W = "0x" + "a".repeat(40), OTHER = "0x" + "b".repeat(40);
  const answer = (body: unknown) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body)));
  it("another wallet's session asks for a signature", async () => {
    const { ensureSession } = await import("@/lib/reauth");
    answer({ authenticated: true, address: OTHER });
    const reauth = vi.fn(async () => true);
    expect(await ensureSession(W, reauth)).toBe(true);
    expect(reauth).toHaveBeenCalledWith(W);
    vi.restoreAllMocks();
  });
  it("this wallet's own session, in any case, needs no signature", async () => {
    const { ensureSession } = await import("@/lib/reauth");
    answer({ authenticated: true, address: W.toUpperCase().replace("0X", "0x") });
    const reauth = vi.fn(async () => true);
    expect(await ensureSession(W, reauth)).toBe(true);
    expect(reauth).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
