import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { worldchain } from "viem/chains";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";
const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as const;
const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS || "0xc976e463bD209E09cb15a168A275890b872AA1F0") as `0x${string}`;

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

async function main() {
  const key = process.env.XMTP_WALLET_KEY;
  if (!key) {
    console.error("No XMTP_WALLET_KEY in .env.local");
    process.exit(1);
  }

  const formattedKey = key.startsWith("0x") ? key : `0x${key}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);

  const pub = createPublicClient({ chain: worldchain, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account, chain: worldchain, transport: http(RPC_URL) });

  console.log(`Wallet: ${account.address}`);
  console.log(`Escrow: ${ESCROW_ADDRESS}`);

  // Check USDC balance
  const balance = await pub.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`USDC balance: ${formatUnits(balance, 6)} USDC`);

  // Check current allowance
  const allowance = await pub.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, ESCROW_ADDRESS],
  });
  console.log(`Current allowance: ${formatUnits(allowance, 6)} USDC`);

  // Check on-chain task count
  const taskCount = await pub.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "taskCount",
  });
  console.log(`On-chain tasks: ${taskCount}`);

  const mode = process.argv[2];

  if (mode === "fund") {
    const bountyUsdc = parseFloat(process.argv[3] || "2");
    const description = process.argv[4] || "Judge review task — verify RELAY FAVOURS works";
    const deadlineHours = parseInt(process.argv[5] || "2");
    const bountyWei = parseUnits(bountyUsdc.toString(), 6);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineHours * 3600);

    console.log(`\nFunding task: "${description}" — $${bountyUsdc} USDC, ${deadlineHours}h deadline`);

    if (balance < bountyWei) {
      console.error(`Insufficient USDC. Have ${formatUnits(balance, 6)}, need ${bountyUsdc}`);
      process.exit(1);
    }

    // Approve if needed
    if (allowance < bountyWei) {
      console.log("Approving USDC spend...");
      const approveTx = await wallet.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [ESCROW_ADDRESS, bountyWei],
      });
      console.log(`Approve tx: ${approveTx}`);
      await pub.waitForTransactionReceipt({ hash: approveTx });
      console.log("Approved.");
    }

    // Create on-chain task
    console.log("Creating on-chain task...");
    const createTx = await wallet.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "createTask",
      args: [description, bountyWei, deadline],
    });
    console.log(`Create tx: ${createTx}`);
    await pub.waitForTransactionReceipt({ hash: createTx });

    const newTaskCount = await pub.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "taskCount",
    });
    const onChainId = Number(newTaskCount) - 1;
    console.log(`\nTask funded on-chain. ID: ${onChainId}`);
    console.log(`TX: https://worldscan.org/tx/${createTx}`);
    console.log(`\nNow link it to the app task via: POST /api/tasks with onChainId=${onChainId} and escrowTxHash=${createTx}`);
  } else {
    console.log("\nUsage:");
    console.log("  npx tsx scripts/fund-tasks.ts           — check balance");
    console.log("  npx tsx scripts/fund-tasks.ts fund 2     — fund a $2 task");
    console.log('  npx tsx scripts/fund-tasks.ts fund 2 "Judge review task" 2');
  }
}

main().catch(console.error);
