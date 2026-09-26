#!/usr/bin/env node
// MARK A CAMPAIGN POOL PAID (pay step, 2026-09-26). Oscar runs this by hand,
// after he has read the USDC transfer on World Chain. This script moves no
// money. It only records that he confirmed the transfer. Nothing in the app
// can mark a pool paid. It reads campaign:draft:<id> and never writes it.
// Funding state is campaign:funding:<id> plus the set campaign:funding:txs.
//
//   node scripts/mark-campaign-paid.mjs <campaignId> <txHash> <amountUsdc>
//   node scripts/mark-campaign-paid.mjs <campaignId> <txHash> <amountUsdc> --apply
//
// Dry run by default. Needs KV_REST_API_URL and KV_REST_API_TOKEN.
// Refuses unless FAVOUR_POOL_ADDRESS is a valid 0x address.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const FEE_BPS = 1000;
const FUNDING_TXS = "campaign:funding:txs";

function poolAddressOrNull(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return ADDRESS_RE.test(t) ? t : null;
}

function fundingQuote(poolUsdc) {
  const poolCents = Math.round(Number(poolUsdc) * 100);
  const feeCents = Math.round((poolCents * FEE_BPS) / 10000);
  return {
    poolUsdc: poolCents / 100,
    feeUsdc: feeCents / 100,
    totalUsdc: (poolCents + feeCents) / 100,
  };
}

const toAddress = poolAddressOrNull(process.env.FAVOUR_POOL_ADDRESS);
if (!toAddress) {
  console.error("The pay step is closed until FAVOUR_POOL_ADDRESS is set.");
  process.exit(1);
}

const U = process.env.KV_REST_API_URL;
const T = process.env.KV_REST_API_TOKEN;
if (!U || !T) { console.error("KV_REST_API_URL and KV_REST_API_TOKEN are required"); process.exit(2); }

async function cmd(...args) {
  const r = await fetch(U, { method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${args[0]} ${r.status}`);
  return (await r.json()).result;
}
const parse = (raw) => (raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null);

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const [id, txHash, amountRaw] = argv.filter((a) => !a.startsWith("--"));
if (!id || !txHash || amountRaw === undefined) {
  console.error("Usage: node scripts/mark-campaign-paid.mjs <campaignId> <txHash> <amountUsdc> [--apply]");
  process.exit(1);
}

console.log("Read the transfer on World Chain first: to FAVOUR_POOL_ADDRESS, token USDC, amount, reference.");

if (!TX_RE.test(txHash)) { console.error("That is not a transaction hash."); process.exit(1); }

const d = parse(await cmd("GET", `campaign:draft:${id}`));
if (!d) { console.error(`No campaign ${id}`); process.exit(1); }
if (d.status !== "published" && d.status !== "publishing") {
  console.error(`${id} is not a published campaign`);
  process.exit(1);
}
if (typeof d.hiddenAt === "string" && d.hiddenAt.length > 0) {
  console.error(`${id} is hidden`);
  process.exit(1);
}

const quote = fundingQuote(d.proposedPoolUsdc);
const amountUsdc = Number(amountRaw);
if (!Number.isFinite(amountUsdc) || Math.round(amountUsdc * 100) < Math.round(quote.totalUsdc * 100)) {
  console.error(`The amount is below the pool plus the FAVOUR fee (${quote.totalUsdc} USDC).`);
  process.exit(1);
}

const fundingKey = `campaign:funding:${id}`;
const existing = await cmd("GET", fundingKey);
if (existing != null && existing !== "") {
  console.error("This campaign is already funded.");
  process.exit(1);
}

const record = {
  txHash,
  amountUsdc,
  paidAt: new Date().toISOString(),
  poolUsdc: quote.poolUsdc,
  feeUsdc: quote.feeUsdc,
  toAddress,
};
const txKey = txHash.toLowerCase();
console.log(APPLY ? "will write:" : "would write:", fundingKey, JSON.stringify(record));

if (!APPLY) {
  const used = await cmd("SISMEMBER", FUNDING_TXS, txKey);
  if (Number(used) === 1) { console.error("This transaction is already used for a campaign."); process.exit(1); }
  console.log("Dry run. Add --apply to write.");
  process.exit(0);
}

const added = await cmd("SADD", FUNDING_TXS, txKey);
if (Number(added) !== 1) { console.error("This transaction is already used for a campaign."); process.exit(1); }
const wrote = await cmd("SET", fundingKey, JSON.stringify(record), "NX");
if (wrote !== "OK") {
  await cmd("SREM", FUNDING_TXS, txKey);
  console.error("This campaign is already funded.");
  process.exit(1);
}
console.log("written:", fundingKey, JSON.stringify(parse(await cmd("GET", fundingKey))));
