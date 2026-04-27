import { createWalletClient, createPublicClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
const ESCROW_ADDRESS = "0xc976e463bD209E09cb15a168A275890b872AA1F0" as `0x${string}`;
const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;

const CLAIMER_KEY = process.env.CLAIMER_KEY as `0x${string}`;

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
  { name: "claimTask", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_taskId", type: "uint256" }], outputs: [] },
  { name: "releasePayment", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_taskId", type: "uint256" }], outputs: [] },
] as const;

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

async function main() {
  const posterKey = process.env.XMTP_WALLET_KEY;
  if (!posterKey) { console.error("No XMTP_WALLET_KEY"); process.exit(1); }

  const formattedPosterKey = posterKey.startsWith("0x") ? posterKey : `0x${posterKey}`;
  const posterAccount = privateKeyToAccount(formattedPosterKey as `0x${string}`);
  const claimerAccount = privateKeyToAccount(CLAIMER_KEY);

  const pub = createPublicClient({ chain: worldchain, transport: http(RPC_URL) });
  const posterWallet = createWalletClient({ account: posterAccount, chain: worldchain, transport: http(RPC_URL) });
  const claimerWallet = createWalletClient({ account: claimerAccount, chain: worldchain, transport: http(RPC_URL) });

  console.log(`Poster:  ${posterAccount.address}`);
  console.log(`Claimer: ${claimerAccount.address}\n`);

  const taskCount = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "taskCount" });

  let openTasks: { id: number; bounty: bigint }[] = [];
  for (let i = 0; i < Number(taskCount); i++) {
    const task = await pub.readContract({ address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "getTask", args: [BigInt(i)] });
    if (task.status === 0) openTasks.push({ id: i, bounty: task.bounty });
  }

  const total = openTasks.reduce((s, t) => s + t.bounty, 0n);
  console.log(`${openTasks.length} open tasks — $${formatUnits(total, 6)} USDC to drain\n`);

  if (openTasks.length === 0) { console.log("Nothing to do."); return; }

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  for (const t of openTasks) {
    const bountyStr = formatUnits(t.bounty, 6);
    process.stdout.write(`#${t.id} ($${bountyStr}) claim...`);
    try {
      const claimTx = await claimerWallet.writeContract({
        address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "claimTask", args: [BigInt(t.id)],
      });
      await pub.waitForTransactionReceipt({ hash: claimTx });
      process.stdout.write(` release...`);

      const releaseTx = await posterWallet.writeContract({
        address: ESCROW_ADDRESS, abi: ESCROW_ABI, functionName: "releasePayment", args: [BigInt(t.id)],
      });
      await pub.waitForTransactionReceipt({ hash: releaseTx });
      console.log(` done`);
    } catch (e: any) {
      console.log(` FAILED: ${e.shortMessage || e.message}`);
    }
    await sleep(1500);
  }

  await sleep(3000);
  const claimerBalance = await pub.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [claimerAccount.address] });
  console.log(`\nClaimer USDC balance: $${formatUnits(claimerBalance, 6)}`);
}

main().catch(console.error);
