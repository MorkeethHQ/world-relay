import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

// Lightweight signed-session layer. Identity in this app is a wallet address;
// the client proves control of it once via MiniKit walletAuth (SIWE), the server
// verifies that signature (see /api/verify-identity) and then issues one of these
// tokens as an HttpOnly cookie. Every mutating route can then trust the caller's
// address from the cookie instead of an unauthenticated body field.
//
// Token format: base64url(`${address}.${expMs}`) + "." + base64url(hmacSHA256).
// HMAC keyed on SESSION_SECRET so it can't be forged without the server key.

export const SESSION_COOKIE = "favour_session";
const SESSION_TTL_MS = 7 * 24 * 3600_000; // 7 days

function secret(): string | null {
  return process.env.SESSION_SECRET || process.env.ADMIN_SECRET || null;
}

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

export function issueSessionToken(address: string, nowMs: number): string | null {
  const key = secret();
  if (!key) return null;
  const payload = `${address.toLowerCase()}.${nowMs + SESSION_TTL_MS}`;
  const sig = createHmac("sha256", key).update(payload).digest("base64url");
  return `${b64url(payload)}.${sig}`;
}

// Returns the verified lowercased address, or null if the token is missing,
// malformed, tampered, or expired. nowMs is passed in so callers control the
// clock (Date.now() is unavailable in some contexts).
export function verifySessionToken(token: string | undefined | null, nowMs: number): string | null {
  if (!token) return null;
  const key = secret();
  if (!key) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let payload: string;
  try {
    payload = Buffer.from(parts[0], "base64url").toString();
  } catch {
    return null;
  }
  const expected = createHmac("sha256", key).update(payload).digest("base64url");
  const got = parts[1];
  if (expected.length !== got.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(got))) return null;
  const [address, expStr] = payload.split(".");
  const exp = Number(expStr);
  if (!address || !Number.isFinite(exp) || exp < nowMs) return null;
  return address;
}

// Reads and verifies the session cookie off a request. Returns the caller's
// verified lowercased wallet address, or null if unauthenticated.
export function getAuthedAddress(req: NextRequest, nowMs: number): string | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, nowMs);
}

// Case-insensitive match between a session address and a body-supplied address.
export function addressMatches(authed: string | null, claimed: unknown): boolean {
  if (!authed || typeof claimed !== "string") return false;
  return authed.toLowerCase() === claimed.toLowerCase();
}

// Kill switch. Session identity is enforced only when SESSION_ENFORCE === "true".
// Shipped OFF so deploying the session layer cannot lock out returning users
// (who load from localStorage and haven't re-authenticated for a cookie yet).
// Flip to "true" in the environment once the login→cookie flow is confirmed in
// the World App; set back to "false" for an instant, code-free rollback.
export function sessionEnforced(): boolean {
  return process.env.SESSION_ENFORCE === "true";
}

// For a mutating route: when enforcement is on, require the caller's session
// cookie to match the wallet address they claim to act as. Returns an error
// string to return as 403, or null when the request may proceed.
export function ownershipError(req: NextRequest, claimedAddress: unknown, nowMs: number): string | null {
  if (!sessionEnforced()) return null;
  const authed = getAuthedAddress(req, nowMs);
  if (!authed) return "Please re-open the app to re-authenticate before this action.";
  if (!addressMatches(authed, claimedAddress)) return "Session does not match the wallet for this action.";
  return null;
}
