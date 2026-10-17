// THE 10 YES GATE (pivot draft "Product Hunt for World", 17 Oct 2026).
//
// A posted app stays pending until YES_GATE distinct outside wallets say YES.
// Outside means what it means for the north star (lib/north-star.isOutside): a
// real wallet, not a TEST DATA fixture, not in NORTH_STAR_EXCLUDE. The maker's
// own wallet never counts for its own app.
//
// RULED 17 Oct 2026 (night run): the gate is in v1, and any signed-in outside
// wallet counts. lib/posted-apps.ts reads it on every YES.

import { isOutside } from "./north-star";

export const YES_GATE = 10;

export type GateState = { yes: number; of: number; status: "pending" | "published" };

/** The gate for one app from the wallets that said YES. Pure. */
export function gateState(voters: readonly string[], maker: string, exclude: Set<string>): GateState {
  const self = String(maker ?? "").toLowerCase();
  const yes = new Set(
    voters.map((v) => String(v ?? "").toLowerCase()).filter((v) => v !== self && isOutside(v, exclude)),
  ).size;
  return { yes, of: YES_GATE, status: yes >= YES_GATE ? "published" : "pending" };
}
