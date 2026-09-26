// Client-safe funding quote and address checks. No Redis. The server store
// lives in campaign-funding.ts.

// 10% on top of the pool. Agent idea 2026-09-26, not yet ruled by Oscar.
export const PLATFORM_FEE_BPS = 1000;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;

function cents(n: number): number {
  return Math.round(n * 100);
}

// pool, fee and total are each in USDC, rounded to cents. fee = pool * bps / 10000.
// total = pool + fee.
export function fundingQuote(poolUsdc: number): { poolUsdc: number; feeUsdc: number; totalUsdc: number } {
  const poolCents = cents(poolUsdc);
  const feeCents = Math.round((poolCents * PLATFORM_FEE_BPS) / 10_000);
  const totalCents = poolCents + feeCents;
  return {
    poolUsdc: poolCents / 100,
    feeUsdc: feeCents / 100,
    totalUsdc: totalCents / 100,
  };
}

// Production env values have carried trailing newlines. Trim, then accept only
// a 20-byte hex address.
export function poolAddressOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return ADDRESS_RE.test(t) ? t : null;
}

export function isTxHash(v: unknown): boolean {
  return typeof v === "string" && TX_RE.test(v);
}

export type CampaignFunding = {
  status: "unpaid" | "paid";
  open: boolean;
  poolUsdc: number;
  feeUsdc: number;
  totalUsdc: number;
  // The campaign id, so the transfer can name which pool it funds.
  reference: string;
  token: "USDC";
  network: "World Chain";
  // Present only when the pay step is open.
  address?: string;
  paidTxHash?: string;
  paidAmountUsdc?: number;
  paidAt?: string;
};
