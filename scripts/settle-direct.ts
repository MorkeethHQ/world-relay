/**
 * Direct settlement escape hatch.
 *
 * For verified, funded tasks the escrow cannot settle on its own — currently
 * any task whose on-chain agent IS the relayer wallet, because AgentEscrowV2's
 * claimTask() rejects msg.sender == task.agent and there is no claimTaskFor().
 *
 * Pays the claimant the full bounty as a direct USDC transfer from the relayer
 * wallet, then marks the task settled in Redis (settlementTx + pendingRelease
 * cleared) so the hourly reconcile cron stops retrying. The bounty locked in
 * escrow becomes refundable to the agent's internal balance via refund() after
 * the task deadline passes.
 *
 * Usage:
 *   npx tsx scripts/settle-direct.ts <taskId> [taskId...]          dry run
 *   npx tsx scripts/settle-direct.ts <taskId> [taskId...] --live   pay + mark settled
 */
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";
import { config } from "dotenv";
import { resolve } from "path";
import { Redis } from "@upstash/redis";

config({ path: resolve(__dirname, "../.env.local") });

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;

const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

async function main() {
  const live = process.argv.includes("--live");
  const ids = process.argv.slice(2).filter((a) => a !== "--live");
  if (ids.length === 0) {
    console.error("Usage: npx tsx scripts/settle-direct.ts <taskId> [taskId...] [--live]");
    process.exit(1);
  }

  const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });

  type StoredTask = {
    id: string;
    description: string;
    claimant?: string;
    bountyUsdc: number;
    status: string;
    pendingRelease?: boolean;
    onChainId?: number | null;
    settlementTx?: string;
  };

  const eligible: StoredTask[] = [];
  for (const id of ids) {
    const raw = await redis.get(`task:${id}`);
    const task = (typeof raw === "string" ? JSON.parse(raw) : raw) as StoredTask | null;
    if (!task) { console.log(`SKIP ${id}: not found`); continue; }
    if (task.settlementTx) { console.log(`SKIP ${id}: already settled (${task.settlementTx})`); continue; }
    if (task.status !== "completed" || task.pendingRelease !== true) {
      console.log(`SKIP ${id}: status=${task.status} pendingRelease=${task.pendingRelease} — only verified pending-release tasks are payable`);
      continue;
    }
    if (!task.claimant || !WALLET_RE.test(task.claimant)) {
      console.log(`SKIP ${id}: invalid claimant ${task.claimant}`);
      continue;
    }
    if (!(task.bountyUsdc > 0)) { console.log(`SKIP ${id}: no USDC bounty`); continue; }
    eligible.push(task);
    console.log(`PAY  $${task.bountyUsdc} -> ${task.claimant}  (${task.description.slice(0, 50)})`);
  }

  const total = eligible.reduce((s, t) => s + t.bountyUsdc, 0);
  console.log(`\n${eligible.length} task(s), $${total.toFixed(2)} USDC total`);
  if (!live) { console.log("Dry run. Re-run with --live to pay."); return; }
  if (eligible.length === 0) return;

  const key = process.env.XMTP_WALLET_KEY!;
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
  const pub = createPublicClient({ chain: worldchain, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account, chain: worldchain, transport: http(RPC_URL) });

  const balance = await pub.readContract({
    address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address],
  });
  console.log(`Relayer ${account.address}: ${formatUnits(balance, 6)} USDC`);
  if (balance < parseUnits(total.toString(), 6)) throw new Error("Insufficient USDC in relayer wallet");

  for (const task of eligible) {
    const tx = await wallet.writeContract({
      address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "transfer",
      args: [task.claimant as `0x${string}`, parseUnits(task.bountyUsdc.toString(), 6)],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") {
      console.error(`TX REVERTED for ${task.id}: ${tx} — NOT marking settled`);
      continue;
    }
    // Same fields markSettled() sets, so the reconcile cron sees it as done.
    const raw = await redis.get(`task:${task.id}`);
    const fresh = (typeof raw === "string" ? JSON.parse(raw) : raw) as StoredTask;
    fresh.pendingRelease = false;
    fresh.settlementTx = tx;
    await redis.set(`task:${task.id}`, JSON.stringify(fresh));
    console.log(`SETTLED ${task.id}: $${task.bountyUsdc} -> ${task.claimant} tx=${tx}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
