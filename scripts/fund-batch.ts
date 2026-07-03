/**
 * Template-driven batch funding + seeding.
 *
 * Usage:
 *   npx tsx scripts/fund-batch.ts <batch.json>          dry run: validate + preview, nothing moves
 *   npx tsx scripts/fund-batch.ts <batch.json> --live   fund USDC tasks on-chain, then seed via /api/seed
 *
 * See scripts/season-batch.template.json for the batch format.
 * Live mode needs XMTP_WALLET_KEY (funding wallet) and ADMIN_SECRET in .env.local,
 * plus "baseUrl" in the batch file pointing at the deployed app.
 */
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";
import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync } from "fs";

config({ path: resolve(__dirname, "../.env.local") });

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;
const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS ||
  "0x274C38eA9944f57D24A59fbEf558bba2264f9351") as `0x${string}`;

const ESCROW_ABI = [
  {
    name: "createTask",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_description", type: "string" },
      { name: "_bounty", type: "uint256" },
      { name: "_deadline", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "taskCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balances",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
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
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const CATEGORIES = new Set(["photo", "delivery", "check-in", "custom", "feedback", "review", "social", "errand"]);

type BatchTask = {
  description: string;
  location: string;
  category: string;
  bountyUsdc: number;
  deadlineHours: number;
  rewardType?: string;
  maxCompletions?: number;
  campaignId?: string;
  agentId?: string;
  onChainId?: number;
  escrowTxHash?: string;
};

function validate(tasks: BatchTask[]): string[] {
  const errors: string[] = [];
  tasks.forEach((t, i) => {
    if (!t.description?.trim()) errors.push(`task ${i}: missing description`);
    if (!t.location?.trim()) errors.push(`task ${i}: missing location`);
    if (!CATEGORIES.has(t.category)) errors.push(`task ${i}: bad category "${t.category}"`);
    if (typeof t.bountyUsdc !== "number" || t.bountyUsdc < 0) errors.push(`task ${i}: bad bountyUsdc`);
    if (typeof t.deadlineHours !== "number" || t.deadlineHours <= 0) errors.push(`task ${i}: bad deadlineHours`);
    if (t.bountyUsdc === 0 && t.rewardType !== "points")
      errors.push(`task ${i}: zero bounty requires rewardType "points"`);
    if (t.bountyUsdc > 0 && t.rewardType === "points")
      errors.push(`task ${i}: points task must have bountyUsdc 0`);
  });
  return errors;
}

async function main() {
  const file = process.argv[2];
  const live = process.argv[3] === "--live";
  if (!file) {
    console.error("Usage: npx tsx scripts/fund-batch.ts <batch.json> [--live]");
    process.exit(1);
  }

  const batch = JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8"));
  const tasks: BatchTask[] = batch.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    console.error("Batch file has no tasks");
    process.exit(1);
  }

  const errors = validate(tasks);
  if (errors.length) {
    console.error("Batch invalid:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const toFund = tasks.filter((t) => t.bountyUsdc > 0 && !t.escrowTxHash);
  const alreadyFunded = tasks.filter((t) => t.bountyUsdc > 0 && t.escrowTxHash);
  const pointsTasks = tasks.filter((t) => t.bountyUsdc === 0);
  const totalUsdc = toFund.reduce((s, t) => s + t.bountyUsdc, 0);

  console.log(`Batch: ${tasks.length} tasks`);
  console.log(`  ${toFund.length} USDC tasks to fund ($${totalUsdc.toFixed(2)} total)`);
  console.log(`  ${alreadyFunded.length} already funded (have escrowTxHash)`);
  console.log(`  ${pointsTasks.length} points-only tasks`);
  for (const t of tasks) {
    const tag = t.bountyUsdc > 0 ? `$${t.bountyUsdc}` : "pts";
    console.log(`  [${tag}] ${t.description.slice(0, 70)}`);
  }

  if (!live) {
    console.log("\nDry run only. Re-run with --live to fund on-chain and seed the app.");
    return;
  }

  // --- Live mode ---
  const key = process.env.XMTP_WALLET_KEY;
  const adminSecret = process.env.ADMIN_SECRET;
  const baseUrl: string | undefined = batch.baseUrl;
  if (!key) throw new Error("No XMTP_WALLET_KEY in .env.local");
  if (!adminSecret) throw new Error("No ADMIN_SECRET in .env.local");
  if (!baseUrl || baseUrl.includes("SET-ME")) throw new Error('Set "baseUrl" in the batch file to the deployed app URL');

  const formattedKey = key.startsWith("0x") ? key : `0x${key}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);
  const pub = createPublicClient({ chain: worldchain, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account, chain: worldchain, transport: http(RPC_URL) });

  // AgentEscrowV2 is deposit-based: createTask spends the agent's INTERNAL
  // balance, not the wallet. Top up the internal balance first if the batch
  // needs more than what's already deposited.
  const [balance, deposited] = await Promise.all([
    pub.readContract({
      address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address],
    }),
    pub.readContract({
      address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "balances", args: [account.address],
    }),
  ]);
  console.log(`\nWallet ${account.address}`);
  console.log(`  in wallet: ${formatUnits(balance, 6)} USDC | deposited in escrow: ${formatUnits(deposited, 6)} USDC`);

  const totalWei = parseUnits(totalUsdc.toString(), 6);
  if (deposited < totalWei) {
    const shortfall = totalWei - deposited;
    if (balance < shortfall) {
      throw new Error(
        `Insufficient USDC: batch needs ${totalUsdc} but escrow deposit is ${formatUnits(deposited, 6)} ` +
        `and wallet only has ${formatUnits(balance, 6)} to top up (needs ${formatUnits(shortfall, 6)} more). ` +
        `Send USDC (World Chain) to ${account.address}.`
      );
    }
    const allowance = await pub.readContract({
      address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [account.address, ESCROW_ADDRESS],
    });
    if (allowance < shortfall) {
      console.log(`Approving ${formatUnits(shortfall, 6)} USDC...`);
      const approveTx = await wallet.writeContract({
        address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "approve", args: [ESCROW_ADDRESS, shortfall],
      });
      await pub.waitForTransactionReceipt({ hash: approveTx });
      console.log(`Approved: ${approveTx}`);
    }
    console.log(`Depositing ${formatUnits(shortfall, 6)} USDC into escrow...`);
    const depositTx = await wallet.writeContract({
      address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "deposit", args: [shortfall],
    });
    await pub.waitForTransactionReceipt({ hash: depositTx });
    console.log(`Deposited: ${depositTx}`);
  }

  // Fund each USDC task on-chain, one at a time, recording onChainId + tx hash.
  for (const t of toFund) {
    const bountyWei = parseUnits(t.bountyUsdc.toString(), 6);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + t.deadlineHours * 3600);
    console.log(`\nFunding $${t.bountyUsdc}: ${t.description.slice(0, 60)}`);
    const tx = await wallet.writeContract({
      address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "createTask",
      args: [t.description, bountyWei, deadline],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
    const count = await pub.readContract({
      address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "taskCount",
    });
    t.onChainId = Number(count) - 1;
    t.escrowTxHash = tx;
    console.log(`  onChainId=${t.onChainId} tx=${tx}`);
  }

  // Seed the whole batch into the app.
  console.log(`\nSeeding ${tasks.length} tasks to ${baseUrl}/api/seed ...`);
  const res = await fetch(`${baseUrl}/api/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: adminSecret, tasks }),
  });
  const data = await res.json();
  if (!res.ok) {
    // On-chain funding already happened — print the enriched batch so nothing is lost.
    console.error(`Seed failed (${res.status}):`, data);
    console.error("\nFunded tasks (save this — escrow is already funded):");
    console.error(JSON.stringify(tasks, null, 2));
    process.exit(1);
  }
  console.log(`Seeded ${data.seeded} tasks:`);
  for (const t of data.tasks) console.log(`  ${t.funded ? "[funded]" : "[points]"} ${t.description}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
