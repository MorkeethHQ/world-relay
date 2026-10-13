import { createHmac } from "node:crypto";

// A PERSON'S PUBLIC ID IS NOT THEIR WALLET (hardening pass, 2026-10-14).
//
// Measured on production 2026-10-13, signed out: GET /api/tasks carried 75
// distinct wallet addresses as poster or claimant, and 56 rows carried exact
// coordinates. The allow list of 2026-10-13 kept both on purpose, so the
// exposure stayed open. This file closes it.
//
// publicId(wallet) is a keyed hash: the same wallet gives the same id on every
// row, so a reader can still tell that two favours share a poster, and nobody
// can turn the id back into the wallet or test a known wallet against it
// without the server's secret. With no secret configured it answers one fixed
// id for everybody: the rule fails closed.
//
// A value that is not a wallet (agent:..., agent_..., relay-bot) is not a
// person's address and is returned as it is.

export const PUBLIC_ID_PREFIX = "p_";
export const NO_SECRET_ID = "p_hidden";
const WALLET = /^0x[0-9a-fA-F]{40}$/;
const ADDRESS_LIKE = /0x[0-9a-fA-F]{40,}/g;
export const HIDDEN = "[hidden]";

function secret(): string | null {
  return process.env.SESSION_SECRET || process.env.ADMIN_SECRET || null;
}

export function isWallet(v: unknown): v is string {
  return typeof v === "string" && WALLET.test(v);
}

export function publicId(wallet: string): string {
  const key = secret();
  if (!key) return NO_SECRET_ID;
  return PUBLIC_ID_PREFIX + createHmac("sha256", key).update(`public-id:${wallet.toLowerCase()}`).digest("hex").slice(0, 16);
}

/** A wallet becomes its public id. Anything else is returned unchanged. */
export function publicIdOrSame<T>(v: T): T | string {
  return isWallet(v) ? publicId(v) : v;
}

export function sameWallet(a: unknown, b: unknown): boolean {
  return isWallet(a) && isWallet(b) && a.toLowerCase() === b.toLowerCase();
}

/** Every 0x run of 40 hex characters or more, at any depth, becomes "[hidden]". The value is copied, never changed in place. */
export function scrubAddresses<T>(value: T): T {
  if (typeof value === "string") return value.replace(ADDRESS_LIKE, HIDDEN) as unknown as T;
  if (Array.isArray(value)) return value.map(scrubAddresses) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubAddresses(v);
    return out as T;
  }
  return value;
}

/** A coordinate with `places` decimals: 1 is about 11 km, 2 is about 1.1 km. Null and non-numbers stay as they are. */
export function coarse<T>(n: T, places: number): T | number {
  if (typeof n !== "number" || !Number.isFinite(n)) return n;
  const k = 10 ** places;
  return Math.round(n * k) / k;
}
