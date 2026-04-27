import { createWalletClient, createPublicClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
const ESCROW_ADDRESS = "0xc976e463bD209E09cb15a168A275890b872AA1F0" as `0x${string}`;
const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;
const OSCAR_WORLD_APP = "0x19c3348e2e2c2505a667875f0f63790b79fec925" as `0x${string}`;

const ESCROW_ABI = [
  { name: "taskCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    name: "getTask", type: "function", stateMutability: "view",
    inputs: [{ name: "_taskId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "poster", type: "address" },
      { name: "claimant", type: "address" },
      { name: "description", type: "string" },
      { name: "bounty", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "status", type: "uint8" },
    ]}],
  },
  { name: "releasePayment", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_taskId", type: "uint256" }], outputs: [] },
] as const;

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

async function main() {
  const key = process.env.XMTP_WALLET_KEY;
  if (!key) { console.error("No XMTP_WALLET_KEY"); process.exit(1); }

  const formattedKey = key.startsWith("0x") ? key : `0x${key}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);
  const pub = createPublicClient({ chain: worldchain, transport: http(RPC_URL) });
  const posterWallet = createWalletClient({ account, chain: worldchain, transport: http(RPC_URL) });

  const taskCount = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "taskCount" });

  // Find all tasks that are Claimed (status=1) by Oscar's World App wallet
  let claimedByOscar: { id: number; bounty: bigint; desc: string }[] = [];
  let openTasks: { id: number; bounty: bigint; desc: string }[] = [];

  for (let i = 0; i < Number(taskCount); i++) {
    const task = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "getTask", args: [BigInt(i)] });
    if (task.status === 1 && task.claimant.toLowerCase() === OSCAR_WORLD_APP.toLowerCase()) {
      claimedByOscar.push({ id: i, bounty: task.bounty, desc: task.description.slice(0, 50) });
    }
    if (task.status === 0) {
      openTasks.push({ id: i, bounty: task.bounty, desc: task.description.slice(0, 50) });
    }
  }

  if (claimedByOscar.length === 0) {
    console.log("No tasks claimed by your World App wallet yet.\n");
    console.log(`${openTasks.length} open tasks waiting to be claimed from World App:`);
    console.log(`Your World App address: ${OSCAR_WORLD_APP}`);
    console.log(`Escrow contract: ${ESCROW_ADDRESS}\n`);
    console.log("Claim these task IDs from World App, then run this script again:\n");
    for (const t of openTasks) {
      console.log(`  #${t.id}  $${formatUnits(t.bounty, 6)}  "${t.desc}"`);
    }
    console.log(`\nTotal reclaimable: $${formatUnits(openTasks.reduce((s, t) => s + t.bounty, 0n), 6)} USDC`);
    process.exit(0);
  }

  const total = claimedByOscar.reduce((s, t) => s + t.bounty, 0n);
  console.log(`Found ${claimedByOscar.length} tasks claimed by your World App — releasing $${formatUnits(total, 6)} USDC\n`);

  const balanceBefore = await pub.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [OSCAR_WORLD_APP] });

  for (const t of claimedByOscar) {
    console.log(`Releasing #${t.id} ($${formatUnits(t.bounty, 6)}) — "${t.desc}"...`);
    try {
      const tx = await posterWallet.writeContract({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "releasePayment",
        args: [BigInt(t.id)],
      });
      await pub.waitForTransactionReceipt({ hash: tx });
      console.log(`  Released: ${tx}`);
    } catch (e: any) {
      console.log(`  FAILED: ${e.shortMessage || e.message}`);
    }
  }

  const balanceAfter = await pub.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [OSCAR_WORLD_APP] });
  console.log(`\nWorld App USDC balance: $${formatUnits(balanceBefore, 6)} → $${formatUnits(balanceAfter, 6)}`);
}

main().catch(console.error);
