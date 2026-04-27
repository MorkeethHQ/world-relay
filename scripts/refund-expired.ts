import { createWalletClient, createPublicClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
const ESCROW_ADDRESS = "0xc976e463bD209E09cb15a168A275890b872AA1F0" as `0x${string}`;
const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;

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
  { name: "refund", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_taskId", type: "uint256" }], outputs: [] },
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
  const wallet = createWalletClient({ account, chain: worldchain, transport: http(RPC_URL) });

  const taskCount = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "taskCount" });
  const now = BigInt(Math.floor(Date.now() / 1000));

  let refundable: { id: number; bounty: bigint; desc: string }[] = [];

  for (let i = 0; i < Number(taskCount); i++) {
    const task = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "getTask", args: [BigInt(i)] });
    // status 0 = Open, 1 = Claimed — both refundable after deadline
    if ((task.status === 0 || task.status === 1) && task.deadline < now) {
      refundable.push({ id: i, bounty: task.bounty, desc: task.description.slice(0, 50) });
    }
  }

  if (refundable.length === 0) {
    console.log("No expired tasks to refund.");
    process.exit(0);
  }

  const totalRefund = refundable.reduce((s, t) => s + t.bounty, 0n);
  console.log(`Found ${refundable.length} expired tasks — $${formatUnits(totalRefund, 6)} USDC to reclaim\n`);

  for (const t of refundable) {
    console.log(`Refunding #${t.id} ($${formatUnits(t.bounty, 6)}) — "${t.desc}"...`);
    try {
      const tx = await wallet.writeContract({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: "refund",
        args: [BigInt(t.id)],
      });
      await pub.waitForTransactionReceipt({ hash: tx });
      console.log(`  Done: ${tx}`);
    } catch (e: any) {
      console.log(`  FAILED: ${e.shortMessage || e.message}`);
    }
  }

  const newBalance = await pub.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
  console.log(`\nWallet balance after refunds: $${formatUnits(newBalance, 6)} USDC`);
}

main().catch(console.error);
