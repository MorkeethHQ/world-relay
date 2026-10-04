import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The three review scripts added on 5 Oct 2026 after a cold walk could not
// reproduce the documented results: scripts/board-from-snapshot.mjs,
// scripts/fake-store.mjs and scripts/board-shot.mjs. Everything here is LOCAL: a
// SYNTHETIC snapshot written to a temp file (made-up favours and wallets, no live
// data), and the fake store on 127.0.0.1.
const run = promisify(execFile);
const dir = mkdtempSync(join(tmpdir(), "operator-scripts-"));
const AT = "2026-10-04T20:35:44Z";
const NOW = Date.parse(AT);
const THROWN = "AI verification error - proof flagged for manual review. | Verified by orb-level human (1.5x multiplier) (trust score: 62)";
const ANA = `0x${"a1".repeat(20)}`;

function favour(id: string, o: Record<string, unknown> = {}) {
  return {
    id, poster: "agent:freshmap", claimant: null, claimantVerification: null, category: "feedback", description: `synthetic favour ${id}, a question nobody has to answer`,
    location: "Anywhere", lat: null, lng: null, bountyUsdc: 12, deadline: "2026-10-18T00:00:00.000Z", status: "open", proofImageUrl: null, proofImages: null, proofNote: null,
    verificationResult: null, attestationTxHash: null, agent: null, aiFollowUp: null, recurring: null, callbackUrl: null, onChainId: null, escrowTxHash: null, claimCode: null,
    taskType: "standard", rewardType: "points", donOnChainId: null, donStakeTxHash: null, requiresClaim: false, pendingRelease: false, maxCompletions: 100, completionCount: 0,
    createdAt: new Date(NOW - 3600_000).toISOString(), ...o,
  };
}
const eightDays = new Date(NOW - 8 * 86400_000).toISOString();
const tasks = [
  ...Array.from({ length: 6 }, (_, i) => favour(`fresh${i}00`)),
  ...Array.from({ length: 9 }, (_, i) => favour(`stale${i}00`, { createdAt: eightDays })),
  favour("thrown100", { status: "claimed", claimant: ANA, claimantVerification: "orb", proofNote: "an answer", verificationResult: { verdict: "flag", reasoning: THROWN, confidence: 0 } }),
  favour("realflag0", { status: "claimed", claimant: ANA, proofNote: "an answer", verificationResult: { verdict: "flag", reasoning: "Too thin to tell.", confidence: 0.6 } }),
  favour("piece-a00", { status: "expired", deadline: "2026-09-29T00:00:00.000Z", companyCampaignId: "draft_x" }),
];
const campaigns = [{ id: "draft_x", company: "Synthetic Co", brief: "a made-up campaign for a test", status: "published", companyChecked: false, publishedAt: "2026-09-22T00:00:00.000Z", pieceTaskIds: { review: "piece-a00" }, pieces: [{ kind: "review", count: 5 }], rewardPerPiecePoints: 10, proposedPoolUsdc: 0, reviewRule: "ai" }];
const tasksFile = join(dir, "api_tasks.json");
const campaignsFile = join(dir, "api_campaigns_company.json");
writeFileSync(tasksFile, JSON.stringify({ tasks }));
writeFileSync(campaignsFile, JSON.stringify({ campaigns }));

describe("scripts/board-from-snapshot.mjs", () => {
  it("prints the board this branch would show: fresh first, stale only as fill, ended campaigns off", async () => {
    const { stdout } = await run("node", ["scripts/board-from-snapshot.mjs", "--tasks", tasksFile, "--campaigns", campaignsFile, "--at", AT, "--json"]);
    const b = JSON.parse(stdout);
    expect(b.heading).toBe("8 of 15 open shown");
    expect(b.shown).toHaveLength(8);
    expect(b.shown.slice(0, 6).every((r: { stale: boolean }) => !r.stale)).toBe(true);
    expect(b.shown.slice(6).every((r: { stale: boolean }) => r.stale)).toBe(true);
    expect(b.leftOut).toHaveLength(7);
    expect(b.companyCampaigns).toEqual({ lead: [], rest: [], ended: ["Synthetic Co"] });
    expect(b.featuredHouseCampaign).toBe("first-favour");
  }, 60000);

  it("the clock matters: a week earlier nothing is stale and all 15 show", async () => {
    const { stdout } = await run("node", ["scripts/board-from-snapshot.mjs", "--tasks", tasksFile, "--at", "2026-09-28T00:00:00Z", "--json"]);
    expect(JSON.parse(stdout).heading).toBe("15 open");
  }, 60000);
});

describe("scripts/fake-store.mjs, and the dry runs anyone can check against it", () => {
  let child: ChildProcess;
  let url = "";
  beforeAll(async () => {
    child = spawn("node", ["scripts/fake-store.mjs", "--tasks", tasksFile, "--campaigns", campaignsFile, "--port", "0"], { stdio: ["ignore", "pipe", "inherit"] });
    url = await new Promise<string>((resolve, reject) => {
      child.stdout!.on("data", (d) => { const m = String(d).match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve(m[0]); });
      child.on("exit", () => reject(new Error("fake store exited")));
      setTimeout(() => reject(new Error("fake store did not start")), 15000);
    });
  }, 20000);
  afterAll(() => { child?.kill(); });

  const env = () => ({ ...process.env, KV_REST_API_URL: url, KV_REST_API_TOKEN: "local", ANTHROPIC_API_KEY: "" });
  const log = async () => (await fetch(`${url}/__log`)).json() as Promise<{ fake: boolean; commands: number; writes: number; counts: Record<string, number>; unknown: string[] }>;

  it("says what it is and how it was seeded", async () => {
    const l = await log();
    expect(l).toMatchObject({ fake: true, commands: 0, writes: 0, seeded: { tasks: 18, campaigns: 1 } });
  });

  it("the re-check dry run reads and sends no write", async () => {
    const { stdout } = await run("node", ["scripts/recheck-thrown-proofs.mjs"], { env: env() });
    expect(stdout).toContain("Dry run. 1 would be re-checked, 0 would be resumed, 0 skipped. Nothing was written.");
    expect(stdout).toContain("would-recheck thrown100");
    expect(stdout).not.toContain("realflag0");
    const l = await log();
    expect(l.writes).toBe(0);
    expect(l.unknown).toEqual([]);
    expect(Object.keys(l.counts).sort()).toEqual(["GET", "SMEMBERS"]);
  }, 60000);

  it("the hide-item list, hide dry run and undo dry run send no write", async () => {
    const before = (await log()).commands;
    const list = await run("node", ["scripts/hide-item.mjs"], { env: env() });
    expect(list.stdout).toContain("Synthetic Co");
    const dry = await run("node", ["scripts/hide-item.mjs", "campaign", "draft_x", "--reason", "ended"], { env: env() });
    expect(dry.stdout).toContain("Dry run. Nothing was written.");
    await run("node", ["scripts/hide-item.mjs", "task", "stale000", "--undo"], { env: env() });
    const l = await log();
    expect(l.commands).toBeGreaterThan(before);
    expect(l.writes).toBe(0);
    expect(l.unknown).toEqual([]);
  }, 60000);

  it("a real hide and undo against the fake are counted as writes, so the counter is not blind", async () => {
    await run("node", ["scripts/hide-item.mjs", "task", "stale000", "--reason", "rehearsal", "--apply"], { env: env() });
    const afterHide = await log();
    expect(afterHide.writes).toBe(1);
    expect(afterHide.counts.EVAL).toBe(1);
    await run("node", ["scripts/hide-item.mjs", "task", "stale000", "--undo", "--apply"], { env: env() });
    expect((await log()).writes).toBe(2);
    const { stdout } = await run("node", ["scripts/hide-item.mjs", "task", "stale000", "--undo"], { env: env() });
    expect(stdout).toContain("already visible");
  }, 60000);
});

describe("scripts/board-shot.mjs", () => {
  it("refuses any base that is not a local server, so it can never load the live app", async () => {
    await expect(run("node", ["scripts/board-shot.mjs", "--tasks", tasksFile, "--campaigns", campaignsFile, "--out", dir, "--base", "https://world-relay.vercel.app"])).rejects.toMatchObject({ code: 2 });
  }, 30000);
});
