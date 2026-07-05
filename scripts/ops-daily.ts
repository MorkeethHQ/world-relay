/**
 * Daily local ops (launchd com.favour.ops, 08:10) — the always-on-Mac layer:
 *   1. Refund any expired on-chain escrow tasks (poster = relayer).
 *   2. Withdraw the relayer's internal escrow balance to its wallet.
 *   3. Flag predictions past lock that still need resolution.
 *   4. Run the pulse report (writes the Obsidian dashboard).
 * Money moves are recoveries of our own deposits only; every action is logged.
 */
import { createWalletClient, createPublicClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";
import { config } from "dotenv";
import { resolve } from "path";
import { execSync } from "child_process";

config({ path: resolve(__dirname, "../.env.local") });

const RPC = "https://worldchain-mainnet.g.alchemy.com/public";
const ESCROW = "0x274C38eA9944f57D24A59fbEf558bba2264f9351" as `0x${string}`;
const APP = "https://world-relay.vercel.app";

const ESCROW_ABI = [
  { name: "taskCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "getTask", type: "function", stateMutability: "view", inputs: [{ name: "_taskId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "poster", type: "address" }, { name: "claimant", type: "address" }, { name: "description", type: "string" },
      { name: "bounty", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "status", type: "uint8" } ]}] },
  { name: "refund", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_taskId", type: "uint256" }], outputs: [] },
  { name: "balances", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

async function main() {
  const log = (m: string) => console.log(`[ops ${new Date().toISOString()}] ${m}`);
  const key = process.env.XMTP_WALLET_KEY;
  if (!key) { log("no relayer key, skipping money steps"); return runPulse(log); }
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
  const pub = createPublicClient({ chain: worldchain, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: worldchain, transport: http(RPC) });

  // 1. Refund expired tasks owned by the relayer.
  const n = Number(await pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "taskCount" }));
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (let i = 0; i < n; i++) {
    const t = await pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "getTask", args: [BigInt(i)] });
    if ((t.status === 0 || t.status === 1) && t.deadline < now && t.poster.toLowerCase() === account.address.toLowerCase()) {
      try {
        const tx = await wallet.writeContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "refund", args: [BigInt(i)] });
        await pub.waitForTransactionReceipt({ hash: tx });
        log(`refunded expired escrow task #${i} ($${formatUnits(t.bounty, 6)}) tx=${tx}`);
      } catch (e) {
        log(`refund #${i} failed: ${(e as Error).message?.slice(0, 120)}`);
      }
    }
  }

  // 2. Withdraw internal balance to the wallet.
  const internal = await pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "balances", args: [account.address] });
  if (internal > 0n) {
    try {
      const tx = await wallet.writeContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "withdraw", args: [internal] });
      const r = await pub.waitForTransactionReceipt({ hash: tx });
      log(`withdrew internal balance $${formatUnits(internal, 6)} status=${r.status} tx=${tx}`);
    } catch (e) {
      log(`withdraw failed: ${(e as Error).message?.slice(0, 120)}`);
    }
  }

  // 3. Predictions past lock, unresolved.
  try {
    const res = await fetch(`${APP}/api/predictions`);
    const d = await res.json();
    const stale = (d.predictions || []).filter((p: { status: string; locked: boolean }) => p.status === "open" && p.locked);
    for (const p of stale) {
      log(`NEEDS RESOLUTION: prediction "${p.question}" is locked and unresolved`);
      try { execSync(`osascript -e 'display notification "Resolve: ${String(p.question).replace(/"/g, "")}" with title "FAVOUR prediction"'`); } catch {}
    }
  } catch (e) {
    log(`prediction check failed: ${(e as Error).message?.slice(0, 80)}`);
  }

  runPulse(log);
}

function runPulse(log: (m: string) => void) {
  try {
    execSync(`npx tsx ${resolve(__dirname, "pulse.ts")}`, { stdio: "inherit", cwd: resolve(__dirname, "..") });
  } catch (e) {
    log(`pulse failed: ${(e as Error).message?.slice(0, 80)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
