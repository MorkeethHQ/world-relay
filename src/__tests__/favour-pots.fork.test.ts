/**
 * FORK RUN: the app's FavourPots library against a local anvil fork of World Chain mainnet,
 * using the REAL deployed FavourPots proxy, real bridged USDC, real canonical Permit2 and the real
 * V2_1 escrow. No real keys: the admin is impersonated to grant OPERATOR to anvil's public test key.
 *
 * Run: anvil --fork-url https://worldchain-mainnet.g.alchemy.com/public --port 8547 --auto-impersonate
 *      FAVOUR_FORK_RPC=http://127.0.0.1:8547 npx vitest run src/__tests__/favour-pots.fork.test.ts
 * Skipped when FAVOUR_FORK_RPC is unset (normal CI). Use a FRESH anvil per run: the poster's real USDC
 * balance is spent by each run.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createTestClient, createPublicClient, http, parseAbi, keccak256, toBytes, type Hex } from "viem";
import { worldchain } from "viem/chains";

const RPC = process.env.FAVOUR_FORK_RPC;
const ANVIL_KEY0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // public anvil test key
const ANVIL_ADDR0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ADMIN = "0x4fD66BdA6d792bE89d1fAeaF9F287AcaCaDBDce6"; // contract admin (impersonated, fork only)
const POSTER = "0x244eEE7101fEE95D5040452d235dEa5A5bAA786b"; // funding wallet, holds real USDC on mainnet
const HELPER = "0x3648b7f52f8f1dff9c412c032271cf3f386b4443";
const FEE_TO = "0x19c3348e2e2c2505a667875f0f63790b79fec925"; // Oscar's fee address on the contract

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const permit2Abi = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const accessAbi = parseAbi(["function grantRole(bytes32 role, address account)"]);
const v21Abi = parseAbi([
  "function fund(bytes32 taskId, address recipient, uint96 amount, uint64 deadline)",
  "function refund(bytes32 taskId)",
  "function getEscrow(bytes32 taskId) view returns ((address funder, address recipient, uint96 amount, uint64 deadline, uint8 status))",
]);

describe.skipIf(!RPC)("FavourPots on a World Chain fork (real USDC, Permit2, deployed proxy)", () => {
  let lib: typeof import("@/lib/favour-pots");
  let USDC: Hex;
  let PERMIT2: Hex;
  let POTS: Hex;
  let V2_1: Hex; // from the config source, never a literal (escrow-v2-address guard)
  const test = createTestClient({ chain: worldchain, mode: "anvil", transport: http(RPC) });
  const pub = createPublicClient({ chain: worldchain, transport: http(RPC) });
  const bal = (who: string) => pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [who as Hex] });

  async function sendAs(from: string, to: Hex, data: Hex) {
    const hash = await test.sendUnsignedTransaction({ from: from as Hex, to, data });
    const r = await pub.waitForTransactionReceipt({ hash });
    expect(r.status).toBe("success");
    return hash;
  }

  /** What World App does in one batch, as separate anvil txs: USDC->Permit2 approve, Permit2 approve, then the app's call. */
  async function signLikeWorldApp(from: string, amount: bigint, payload: { transactions: Array<{ to: Hex; data: Hex }> }) {
    const { encodeFunctionData } = await import("viem");
    await sendAs(from, USDC, encodeFunctionData({ abi: erc20, functionName: "approve", args: [PERMIT2, amount] }));
    const now = (await pub.getBlock()).timestamp;
    await sendAs(from, PERMIT2, encodeFunctionData({ abi: permit2Abi, functionName: "approve", args: [USDC, POTS, amount, Number(now) + 600] }));
    // payload[0] is the in-batch permit2.approve(.., expiration 0); payload[1] is the real app call.
    expect(payload.transactions[0].to).toBe(PERMIT2);
    return sendAs(from, payload.transactions[1].to, payload.transactions[1].data);
  }

  beforeAll(async () => {
    process.env.FAVOUR_RPC_URL = RPC;
    process.env.XMTP_WALLET_KEY = ANVIL_KEY0;
    lib = await import("@/lib/favour-pots");
    USDC = (await import("@/lib/contracts")).USDC_ADDRESS as Hex;
    PERMIT2 = (await import("@/lib/escrow-v2")).PERMIT2_ADDRESS as Hex;
    V2_1 = (await import("@/lib/escrow-v2")).escrowV2Address();
    POTS = lib.favourPotsAddress();
    expect(await pub.getChainId()).toBe(480);
    await test.setBalance({ address: ANVIL_ADDR0, value: BigInt(1e18) });
    for (const a of [ADMIN, POSTER]) await test.setBalance({ address: a as Hex, value: BigInt(1e18) });
    const { encodeFunctionData } = await import("viem");
    await sendAs(ADMIN, POTS, encodeFunctionData({ abi: accessAbi, functionName: "grantRole", args: [keccak256(toBytes("OPERATOR_ROLE")), ANVIL_ADDR0] }));
    expect(lib.operatorAddress()).toBe(ANVIL_ADDR0);
    expect(await bal(POSTER)).toBeGreaterThan(BigInt(1_000_000));
  }, 60_000);

  it("admin pot: open, fund via Permit2, pay a helper, fee reaches Oscar's address", async () => {
    const { campaignId } = await lib.serverOpenCampaign(BigInt(1_000_000)); // cap 1 USDC
    await signLikeWorldApp(POSTER, BigInt(2_000_000), lib.buildFundCampaignTx(campaignId, BigInt(2_000_000)));
    expect((await lib.getCampaignRecord(campaignId))!.balance).toBe(BigInt(2_000_000));

    await lib.withdrawFeesBestEffort();
    const h0 = await bal(HELPER);
    const f0 = await bal(FEE_TO);
    await lib.serverPayFromPot(campaignId, keccak256(toBytes("favour:fork-1")), HELPER, BigInt(1_000_000));
    expect((await bal(HELPER)) - h0).toBe(BigInt(975_000));
    expect(await lib.withdrawFeesBestEffort()).not.toBeNull();
    expect((await bal(FEE_TO)) - f0).toBe(BigInt(25_000));
    expect((await lib.getCampaignRecord(campaignId))!.balance).toBe(BigInt(1_000_000));
  }, 120_000);

  it("user single favour with 0.1 USDC: fund via Permit2, server releases to the helper, fee to Oscar", async () => {
    const taskId = `fork-single-${Date.now()}`;
    const now = (await pub.getBlock()).timestamp;
    const amount = BigInt(100_000);
    await signLikeWorldApp(POSTER, amount, lib.buildFundFavourTx(taskId, amount, now + BigInt(86_400), ANVIL_ADDR0));
    const id = lib.favourIdFor(POSTER, taskId);
    const rec = await lib.getFavourRecord(id);
    expect(rec!.status).toBe(lib.FavourStatus.Funded);
    expect(rec!.amount).toBe(amount);
    expect(rec!.funder.toLowerCase()).toBe(POSTER.toLowerCase());
    expect(rec!.releaser).toBe(ANVIL_ADDR0);
    expect(await lib.findPotsEventTx(lib.EVENT_FAVOUR_FUNDED, id)).toMatch(/^0x[0-9a-f]{64}$/);

    await lib.withdrawFeesBestEffort(); // clear fees from earlier steps so the delta is this payout's
    const h0 = await bal(HELPER);
    const f0 = await bal(FEE_TO);
    await lib.serverReleaseFavour(id, HELPER);
    expect((await bal(HELPER)) - h0).toBe(BigInt(97_500));
    await lib.withdrawFeesBestEffort();
    expect((await bal(FEE_TO)) - f0).toBe(BigInt(2_500));
    expect((await lib.getFavourRecord(id))!.status).toBe(lib.FavourStatus.Released);
    expect(await lib.findPotsEventTx(lib.EVENT_FAVOUR_RELEASED, id)).toMatch(/^0x/);
  }, 120_000);

  it("poster releases from their own wallet (MiniKit payload) to a helper chosen at release", async () => {
    const taskId = `fork-poster-release-${Date.now()}`;
    const now = (await pub.getBlock()).timestamp;
    await signLikeWorldApp(POSTER, BigInt(100_000), lib.buildFundFavourTx(taskId, BigInt(100_000), now + BigInt(86_400), ANVIL_ADDR0));
    const id = lib.favourIdFor(POSTER, taskId);
    const h0 = await bal(HELPER);
    const tx = lib.buildReleaseFavourTx(id, HELPER).transactions[0];
    await sendAs(POSTER, tx.to, tx.data);
    expect((await bal(HELPER)) - h0).toBe(BigInt(97_500));
  }, 120_000);

  it("refund after the deadline returns the full 0.1 USDC to the poster, no fee", async () => {
    const taskId = `fork-refund-${Date.now()}`;
    const now = (await pub.getBlock()).timestamp;
    await signLikeWorldApp(POSTER, BigInt(100_000), lib.buildFundFavourTx(taskId, BigInt(100_000), now + BigInt(120), ANVIL_ADDR0));
    const id = lib.favourIdFor(POSTER, taskId);
    await test.increaseTime({ seconds: 200 });
    await test.mine({ blocks: 1 });
    const p0 = await bal(POSTER);
    await lib.serverRefundFavour(id);
    expect((await bal(POSTER)) - p0).toBe(BigInt(100_000));
    expect((await lib.getFavourRecord(id))!.status).toBe(lib.FavourStatus.Refunded);
  }, 120_000);

  it("V2_1 still funds, reads and refunds on its own contract", async () => {
    const { encodeFunctionData } = await import("viem");
    const taskHash = keccak256(toBytes(`fork-v21-${Date.now()}`));
    const now = (await pub.getBlock()).timestamp;
    await sendAs(POSTER, USDC, encodeFunctionData({ abi: erc20, functionName: "approve", args: [V2_1, BigInt(100_000)] }));
    await sendAs(POSTER, V2_1, encodeFunctionData({ abi: v21Abi, functionName: "fund", args: [taskHash, HELPER, BigInt(100_000), now + BigInt(120)] }));
    const e = await pub.readContract({ address: V2_1, abi: v21Abi, functionName: "getEscrow", args: [taskHash] });
    expect(e.status).toBe(1);
    await test.increaseTime({ seconds: 200 });
    await test.mine({ blocks: 1 });
    const p0 = await bal(POSTER);
    await sendAs(ANVIL_ADDR0, V2_1, encodeFunctionData({ abi: v21Abi, functionName: "refund", args: [taskHash] }));
    expect((await bal(POSTER)) - p0).toBe(BigInt(100_000));
  }, 120_000);
});
