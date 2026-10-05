import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// THE CONFIRM CODE, THIRD COLD READ (2026-10-05). Everything here is LOCAL: two
// copies of the shipped fake store on 127.0.0.1, seeded from the SAME synthetic
// snapshot (made-up favours and wallets), a verifier double, and a dummy model key.
//
// What the reader found: the re-check code was a hash of the picked ids and
// wallets only. Two stores with the same list printed the same code, so a code
// from a rehearsal would have started the production run. A refused apply
// printed the valid code. And no output line said which store had answered.
const run = promisify(execFile);
const dir = mkdtempSync(join(tmpdir(), "confirm-code-"));
const THROWN = "AI verification error - proof flagged for manual review. | Verified by orb-level human (1.5x multiplier) (trust score: 62)";
const ANA = `0x${"a1".repeat(20)}`;
const BEN = `0x${"b2".repeat(20)}`;
function favour(id: string, o: Record<string, unknown> = {}) {
  return {
    id, poster: "agent:freshmap", claimant: ANA, claimantVerification: "orb", category: "feedback", description: `synthetic favour ${id}, a question nobody has to answer`,
    location: "Anywhere", lat: null, lng: null, bountyUsdc: 12, deadline: "2026-12-18T00:00:00.000Z", status: "claimed", proofImageUrl: null, proofImages: null, proofNote: "an answer",
    verificationResult: { verdict: "flag", reasoning: THROWN, confidence: 0 }, attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null, callbackUrl: null, onChainId: null,
    escrowTxHash: null, claimCode: null, taskType: "standard", rewardType: "points", donOnChainId: null, donStakeTxHash: null, requiresClaim: false, pendingRelease: false,
    maxCompletions: 100, completionCount: 0, createdAt: "2026-09-26T08:20:00.000Z", ...o,
  };
}
const tasksFile = join(dir, "api_tasks.json");
const campaignsFile = join(dir, "api_campaigns_company.json");
writeFileSync(tasksFile, JSON.stringify({ tasks: [favour("thrown100"), favour("thrown200", { claimant: BEN }), favour("piece-a00", { status: "expired", claimant: null, verificationResult: null, companyCampaignId: "draft_x" })] }));
writeFileSync(campaignsFile, JSON.stringify({ campaigns: [{ id: "draft_x", company: "Synthetic Co", brief: "a made-up campaign for a test", status: "published", pieceTaskIds: { review: "piece-a00" }, pieces: [{ kind: "review", count: 5 }] }] }));

type Fake = { child: ChildProcess; url: string };
async function startFake(): Promise<Fake> {
  const child = spawn("node", ["scripts/fake-store.mjs", "--tasks", tasksFile, "--campaigns", campaignsFile, "--port", "0"], { stdio: ["ignore", "pipe", "inherit"] });
  const url = await new Promise<string>((resolve, reject) => {
    child.stdout!.on("data", (d) => { const m = String(d).match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve(m[0]); });
    setTimeout(() => reject(new Error("fake store did not start")), 15000);
  });
  return { child, url };
}
let A: Fake;
let B: Fake;
let codes: string;
beforeAll(async () => { A = await startFake(); B = await startFake(); }, 40000);
afterAll(() => { A?.child.kill(); B?.child.kill(); });
beforeEach(() => { codes = mkdtempSync(join(dir, "codes-")); });

const writes = async (f: Fake) => ((await (await fetch(`${f.url}/__log`)).json()) as { writes: number }).writes;
const env = (f: Fake | string, extra: Record<string, string> = {}) => ({
  ...process.env, KV_REST_API_URL: typeof f === "string" ? f : f.url, KV_REST_API_TOKEN: "local", FAVOUR_CONFIRM_DIR: codes,
  ANTHROPIC_API_KEY: "local-rehearsal-not-a-key", RECHECK_VERIFIER_MODULE: "scripts/rehearsal-verifier.mjs", ...extra,
});
async function sh(script: string, args: string[], e: NodeJS.ProcessEnv) {
  try {
    const r = await run("node", [`scripts/${script}`, ...args], { env: e });
    return { code: 0, out: r.stdout + r.stderr, first: (r.stdout + r.stderr).split("\n")[0] };
  } catch (x) {
    const err = x as { code?: number; stdout?: string; stderr?: string };
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    return { code: err.code ?? -1, out, first: out.split("\n")[0] };
  }
}
const codeOf = (out: string) => out.match(/--apply --confirm ([0-9a-f]{10})/)?.[1];
const HEX10 = /\b[0-9a-f]{10}\b/;
const hostOf = (f: Fake) => new URL(f.url).host;

describe("re-check: the code belongs to one store", () => {
  it("two stores with the same list give codes that do not work on each other", async () => {
    const dryA = await sh("recheck-thrown-proofs.mjs", ["--limit", "1"], env(A));
    const dryB = await sh("recheck-thrown-proofs.mjs", ["--limit", "1"], env(B));
    const a = codeOf(dryA.out)!;
    const b = codeOf(dryB.out)!;
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(a).not.toBe(b);

    const before = await writes(B);
    const cross = await sh("recheck-thrown-proofs.mjs", ["--limit", "1", "--apply", "--confirm", a], env(B));
    expect(cross.code).toBe(2);
    expect(await writes(B)).toBe(before);

    const own = await sh("recheck-thrown-proofs.mjs", ["--limit", "1", "--apply", "--confirm", a], env(A));
    expect(own.code).toBe(0);
    expect(own.out).toContain("Applied. passed 1");
    expect(await writes(A)).toBeGreaterThan(0);
  }, 90000);

  it("a code cannot be worked out from the list: two dry runs of the same list give different codes", async () => {
    const one = codeOf((await sh("recheck-thrown-proofs.mjs", [], env(B))).out);
    const two = codeOf((await sh("recheck-thrown-proofs.mjs", [], env(B))).out);
    expect(one).toMatch(/^[0-9a-f]{10}$/);
    expect(one).not.toBe(two);
  }, 60000);

  it("a code is used up by its run, and a code older than its time limit is refused", async () => {
    const dry = await sh("recheck-thrown-proofs.mjs", ["--only", "thrown200"], env(B));
    const code = codeOf(dry.out)!;
    // Age the record the dry run left on this machine.
    const file = join(codes, readdirSync(codes).find((f) => f.includes(code))!);
    const rec = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...rec, issuedAt: Date.now() - 3 * 3600_000 }));
    const before = await writes(B);
    const old = await sh("recheck-thrown-proofs.mjs", ["--only", "thrown200", "--apply", "--confirm", code], env(B));
    expect(old.code).toBe(2);
    expect(await writes(B)).toBe(before);

    const fresh = codeOf((await sh("recheck-thrown-proofs.mjs", ["--only", "thrown200"], env(B))).out)!;
    expect((await sh("recheck-thrown-proofs.mjs", ["--only", "thrown200", "--apply", "--confirm", fresh], env(B))).code).toBe(0);
    const after = await writes(B);
    expect((await sh("recheck-thrown-proofs.mjs", ["--only", "thrown200", "--apply", "--confirm", fresh], env(B))).code).toBe(2);
    expect(await writes(B)).toBe(after);
  }, 90000);
});

describe("re-check: a refusal says run the dry run and nothing more", () => {
  it("with a dummy key and a verifier double the placeholder reaches the code gate, and the refusal carries no code and no list", async () => {
    const before = await writes(B);
    for (const args of [["--apply", "--confirm", "PASTE_CODE_HERE"], ["--apply", "--confirm", "abcdef0123"], ["--apply"]]) {
      const r = await sh("recheck-thrown-proofs.mjs", args, env(B));
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.out).not.toContain("needs ANTHROPIC_API_KEY");
      expect(r.out).toContain("Run the dry run");
      // Nothing after the first line (which names the store and its port) may look like a code.
      expect(r.out.split("\n").slice(1).join("\n").replace("abcdef0123", "")).not.toMatch(HEX10);
      expect(r.out).not.toContain("would-recheck");
      expect(r.out).not.toContain("thrown");
    }
    expect(await writes(B)).toBe(before);
  }, 90000);

  it("a placeholder or a made-up code is refused before anything is read from the store", async () => {
    const commands = async () => ((await (await fetch(`${B.url}/__log`)).json()) as { commands: number }).commands;
    const before = await commands();
    await sh("recheck-thrown-proofs.mjs", ["--apply", "--confirm", "PASTE_CODE_HERE"], env(B));
    await sh("recheck-thrown-proofs.mjs", ["--apply", "--confirm", "abcdef0123"], env(B));
    await sh("hide-item.mjs", ["task", "piece-a00", "--apply", "--confirm", "PASTE_CODE_HERE"], env(B));
    await sh("hide-item.mjs", ["campaign", "draft_x", "--undo", "--apply", "--confirm", "abcdef0123"], env(B));
    expect(await commands()).toBe(before);
  }, 90000);
});

describe("every output starts by naming the store", () => {
  it("re-check: dry run, refusal and apply all start with the host and the words LOCAL FAKE", async () => {
    const dry = await sh("recheck-thrown-proofs.mjs", ["--limit", "1"], env(B));
    const refused = await sh("recheck-thrown-proofs.mjs", ["--apply", "--confirm", "abcdef0123"], env(B));
    for (const r of [dry, refused]) {
      expect(r.first).toContain(hostOf(B));
      expect(r.first).toContain("LOCAL FAKE");
    }
    expect(dry.out).toContain(`--apply --confirm ${codeOf(dry.out)}`);
  }, 60000);

  it("hide-item: list, dry run, refusal and apply all start with the host and the words LOCAL FAKE", async () => {
    const list = await sh("hide-item.mjs", [], env(B));
    const dry = await sh("hide-item.mjs", ["task", "piece-a00", "--reason", "rehearsal"], env(B));
    const refused = await sh("hide-item.mjs", ["task", "piece-a00", "--reason", "rehearsal", "--apply", "--confirm", "abcdef0123"], env(B));
    const applied = await sh("hide-item.mjs", ["task", "piece-a00", "--reason", "rehearsal", "--apply", "--confirm", codeOf(dry.out)!], env(B));
    for (const r of [list, dry, refused, applied]) {
      expect(r.first).toContain(hostOf(B));
      expect(r.first).toContain("LOCAL FAKE");
    }
    expect(applied.code).toBe(0);
  }, 60000);

  it("a store that is not on this machine is named as NOT LOCAL, in capitals, before anything else", async () => {
    // --apply with no code is refused before any request is sent, so this host is never contacted.
    const r = await sh("recheck-thrown-proofs.mjs", ["--apply"], env("https://store.example.invalid"));
    expect(r.code).toBe(2);
    expect(r.first).toContain("store.example.invalid");
    expect(r.first).toContain("NOT LOCAL");
    expect(r.first).not.toContain("LOCAL FAKE");
    const h = await sh("hide-item.mjs", ["task", "x", "--apply"], env("https://store.example.invalid"));
    expect(h.first).toContain("NOT LOCAL");
  }, 60000);

  it("a local address that is not the fake is not called the fake", async () => {
    const r = await sh("recheck-thrown-proofs.mjs", ["--apply"], env("http://127.0.0.1:9"));
    expect(r.first).toContain("127.0.0.1:9");
    expect(r.first).not.toContain("LOCAL FAKE");
    expect(r.first).toContain("did not identify itself");
  }, 60000);
});

describe("hide-item: the code belongs to one store, and a refusal says run the dry run", () => {
  it("a code from one store is refused on another with the same records", async () => {
    const dryA = await sh("hide-item.mjs", ["campaign", "draft_x", "--reason", "ended"], env(A));
    const a = codeOf(dryA.out)!;
    const before = await writes(B);
    const cross = await sh("hide-item.mjs", ["campaign", "draft_x", "--reason", "ended", "--apply", "--confirm", a], env(B));
    expect(cross.code).toBe(2);
    expect(cross.out).toContain("Run the dry run");
    expect(cross.out.split("\n").slice(1).join("\n").replace(a, "")).not.toMatch(HEX10);
    expect(await writes(B)).toBe(before);
    expect((await sh("hide-item.mjs", ["campaign", "draft_x", "--reason", "ended", "--apply", "--confirm", a], env(A))).code).toBe(0);
  }, 90000);
});
