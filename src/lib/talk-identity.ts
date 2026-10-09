// WHO IS TALKING. SECURITY-INVARIANTS.md, Inv 4: identity is proven, not claimed.
//
// A person is the wallet the session cookie proves (getAuthedAddress), never a
// field in the body. An agent is the bearer key it sends (validateApiKey), and
// its name is the one it registered with. The body is not read here at all.
// When a bearer header is present the request is an agent's; a session cookie
// beside it is ignored, so one request has one author.

import type { NextRequest } from "next/server";
import { validateApiKey } from "@/lib/api-keys";
import { getAuthedAddress } from "@/lib/session";
import { worldName, type Author } from "@/lib/talk";

const KEEP_MS = 10 * 60_000;
const names = new Map<string, { at: number; name: string; picture: string | null }>();

/** The World username for a wallet, kept for ten minutes, else the profile's short handle. */
export async function personName(wallet: string, now: number): Promise<{ name: string; picture: string | null }> {
  const kept = names.get(wallet);
  if (kept && now - kept.at < KEEP_MS) return kept;
  const found = await worldName(wallet);
  const entry = { at: found.username ? now : now - KEEP_MS + 60_000, name: found.name, picture: found.picture };
  names.set(wallet, entry);
  return entry;
}

export type Identity = { author: Author; via: "session" | "key" } | null;

export async function identityOf(req: NextRequest, now: number): Promise<Identity> {
  const auth = req.headers.get("authorization");
  if (auth) {
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;
    const key = await validateApiKey(token);
    if (!key.valid || !key.agentId) return null;
    return { author: { kind: "agent", ref: key.agentId, name: key.name || key.agentId }, via: "key" };
  }
  const wallet = getAuthedAddress(req, now);
  if (!wallet) return null;
  const { name, picture } = await personName(wallet, now);
  return { author: { kind: "person", ref: wallet.toLowerCase(), name, picture }, via: "session" };
}
