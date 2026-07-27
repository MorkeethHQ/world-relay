// FAVOUR pulse — daily ops monitor. Tracks funds (escrow + wallets), task and
// campaign creation, claimant behaviour, and settlement health. Writes a
// markdown report to the Obsidian dashboard and keeps a JSON snapshot next to
// this script for day-over-day deltas. Read-only: public RPC + public API,
// no keys required.
//
//   npx tsx scripts/pulse.ts            # writes report + snapshot
//   npx tsx scripts/pulse.ts --stdout   # print report only, no files
import { createPublicClient, http, formatUnits } from "viem";
import { worldchain } from "viem/chains";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const APP_URL = "https://world-relay.vercel.app";
const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
const USDC = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;
const ESCROW = "0x274C38eA9944f57D24A59fbEf558bba2264f9351" as `0x${string}`;
const RELAYER = "0x1101158041Fd96f21CBcbb0E752a9A2303E6D70e" as `0x${string}`;
const FUNDING_WALLET = "0x244eEE7101fEE95D5040452d235dEa5A5bAA786b" as `0x${string}`;

const VAULT = path.join(
  os.homedir(),
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian LIFE",
);
const REPORT_PATH = path.join(VAULT, "00 Dashboard/favour-pulse.md");
const STATE_PATH = path.join(__dirname, ".pulse-state.json");

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

type ApiTask = {
  id: string;
  poster: string;
  claimant: string | null;
  status: string;
  bountyUsdc: number;
  rewardType: string;
  campaignId: string | null;
  onChainId: number | null;
  escrowTxHash: string | null;
  pendingRelease: boolean;
  settlementTx: string | null;
  createdAt: string;
  description: string;
  agent: unknown;
  completionCount: number;
};

type Snapshot = {
  at: string;
  escrowUsdc: number;
  relayerUsdc: number;
  fundingUsdc: number;
  taskIds: string[];
  completedIds: string[];
};

const isSeeded = (t: ApiTask) => !!t.agent || t.poster.startsWith("agent:");
const isFunded = (t: ApiTask) => t.onChainId !== null || !!t.escrowTxHash;
const fmt = (n: number) => `$${n.toFixed(2)}`;
const delta = (now: number, prev: number | undefined) =>
  prev === undefined ? "" : ` (${now - prev >= 0 ? "+" : ""}${(now - prev).toFixed(2)} vs last run)`;

async function main() {
  const stdoutOnly = process.argv.includes("--stdout");

  const pub = createPublicClient({ chain: worldchain, transport: http(RPC_URL) });
  const [escrowBal, relayerBal, fundingBal] = await Promise.all([
    pub.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [ESCROW] }),
    pub.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [RELAYER] }),
    pub.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [FUNDING_WALLET] }),
  ]);
  const escrowUsdc = Number(formatUnits(escrowBal, 6));
  const relayerUsdc = Number(formatUnits(relayerBal, 6));
  const fundingUsdc = Number(formatUnits(fundingBal, 6));

  const res = await fetch(`${APP_URL}/api/tasks`);
  if (!res.ok) throw new Error(`GET /api/tasks failed: ${res.status}`);
  const { tasks } = (await res.json()) as { tasks: ApiTask[] };

  let prev: Snapshot | null = null;
  try {
    prev = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    /* first run */
  }

  const now = Date.now();
  const dayAgo = now - 86_400_000;
  const last24h = tasks.filter((t) => new Date(t.createdAt).getTime() >= dayAgo);
  const prevIds = new Set(prev?.taskIds || []);
  const newSincePrev = prev ? tasks.filter((t) => !prevIds.has(t.id)) : last24h;

  // Creation breakdown (last 24h)
  const userPosted = last24h.filter((t) => !isSeeded(t));
  const seeded = last24h.filter(isSeeded);
  const byCampaign = new Map<string, number>();
  for (const t of last24h) byCampaign.set(t.campaignId || "(none)", (byCampaign.get(t.campaignId || "(none)") || 0) + 1);

  // Completions since last snapshot
  const prevCompleted = new Set(prev?.completedIds || []);
  const completedAll = tasks.filter((t) => t.status === "completed");
  const newlyCompleted = completedAll.filter((t) => !prevCompleted.has(t.id));

  // Claimant concentration on seeded tasks (all-time completed)
  const seededEarns = new Map<string, number>();
  for (const t of completedAll.filter(isSeeded)) {
    if (t.claimant) seededEarns.set(t.claimant, (seededEarns.get(t.claimant) || 0) + 1);
  }
  const topClaimants = [...seededEarns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Health flags
  const stuckSettlements = tasks.filter((t) => t.pendingRelease);
  const openFunded = tasks.filter((t) => t.status === "open" && isFunded(t));
  const descCounts = new Map<string, number>();
  for (const t of tasks.filter((x) => x.status === "open")) {
    const k = t.description.toLowerCase().replace(/\s+/g, " ").trim();
    descCounts.set(k, (descCounts.get(k) || 0) + 1);
  }
  const dupeDescs = [...descCounts.values()].filter((n) => n > 2).length;

  const alerts: string[] = [];
  if (fundingUsdc < 2) alerts.push(`Funding wallet low: ${fmt(fundingUsdc)} USDC — no more seeding until topped up`);
  if (relayerUsdc < 1) alerts.push(`Relayer wallet low: ${fmt(relayerUsdc)} USDC`);
  if (stuckSettlements.length > 0) alerts.push(`${stuckSettlements.length} settlement(s) pending release — check reconcile cron`);
  if (dupeDescs > 0) alerts.push(`${dupeDescs} duplicate description group(s) on the open board`);
  for (const [addr, n] of topClaimants) {
    const newEarnsToday = newlyCompleted.filter((t) => isSeeded(t) && t.claimant === addr && isFunded(t)).length;
    if (newEarnsToday > 1) alerts.push(`Wallet ${addr.slice(0, 8)}… earned ${newEarnsToday} funded seeded tasks since last run (cap should hold this to 1/day)`);
    void n;
  }

  const stamp = new Date().toISOString();
  const lines: string[] = [
    "---",
    `date: ${stamp.slice(0, 10)}`,
    "tags: [favour, pulse, live-dashboard]",
    "source: claude-code",
    "---",
    "",
    "# FAVOUR pulse",
    `Updated ${stamp} (auto-generated by \`scripts/pulse.ts\`, runs daily)`,
    "",
    "## Alerts",
    ...(alerts.length ? alerts.map((a) => `- ⚠️ ${a}`) : ["- ✅ none"]),
    "",
    "## Funds",
    `- Escrow contract: ${fmt(escrowUsdc)}${delta(escrowUsdc, prev?.escrowUsdc)}`,
    `- Relayer 0x1101…D70e: ${fmt(relayerUsdc)}${delta(relayerUsdc, prev?.relayerUsdc)}`,
    `- Funding wallet 0x244e…786b: ${fmt(fundingUsdc)}${delta(fundingUsdc, prev?.fundingUsdc)}`,
    `- Open funded tasks: ${openFunded.length} (${fmt(openFunded.reduce((s, t) => s + t.bountyUsdc, 0))} committed)`,
    `- Settlements pending: ${stuckSettlements.length}`,
    "",
    "## Created (last 24h)",
    `- User-posted: ${userPosted.length}`,
    `- Seeded: ${seeded.length}`,
    ...[...byCampaign.entries()].map(([c, n]) => `  - campaign ${c}: ${n}`),
    "",
    `## Completed since last run: ${newlyCompleted.length}`,
    ...newlyCompleted.slice(0, 10).map((t) => `- ${isFunded(t) ? fmt(t.bountyUsdc) : `${t.bountyUsdc} pts`} ${isSeeded(t) ? "[seeded]" : "[user]"} ${t.description.slice(0, 60)}`),
    "",
    "## Seeded-task earners (all-time, top 5)",
    ...topClaimants.map(([addr, n]) => `- ${addr}: ${n}`),
    "",
    `Board: ${tasks.filter((t) => t.status === "open").length} open / ${completedAll.length} completed / ${tasks.length} total`,
  ];
  const report = lines.join("\n") + "\n";

  console.log(report);

  if (!stdoutOnly) {
    try {
      fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
      fs.writeFileSync(REPORT_PATH, report);
      console.log(`Report written to ${REPORT_PATH}`);
    } catch (e) {
      // iCloud placeholder files intermittently throw EIO/"Unknown system error -11"
      // on write. Don't let a transient sync glitch crash the run before the state
      // snapshot below is saved — carry on without today's dashboard update.
      console.error("vault report write failed, continuing without it:", e);
    }
    const snapshot: Snapshot = {
      at: stamp,
      escrowUsdc,
      relayerUsdc,
      fundingUsdc,
      taskIds: tasks.map((t) => t.id),
      completedIds: completedAll.map((t) => t.id),
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(snapshot, null, 2));
  }
}

main().catch((err) => {
  console.error("[pulse] failed:", err);
  process.exit(1);
});
