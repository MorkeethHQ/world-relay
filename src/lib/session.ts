import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { trackEvent } from "./track";

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
//
// STATUS 2026-09-16. This switch defaults to the PERMISSIVE side, which is the
// unsafe direction, and it has stayed there long enough to become the product's
// open hole: an unauthenticated POST to /api/jury as an arbitrary wallet was
// answered 409 by production rather than 403, so anyone can farm jury points
// onto any address behind nothing but an IP rate limit. Jury is the app's
// dominant human action at 2,738 lifetime verdicts.
//
// It was NOT flipped on 2026-09-16, and the reason is a finding rather than
// caution. THE FLIP WOULD LOCK OUT MOST LIVE USERS TODAY:
//   - The cookie is issued only inside /api/verify-identity, only when a SIWE
//     signature verifies, and it lasts 7 days.
//   - src/app/page.tsx treats a stored `relay_user_id` in localStorage as signed
//     in and never calls /api/verify-identity again, so a returning user never
//     refreshes the cookie. retention.ts records the same behaviour measured
//     against prod on 2026-07-29: wallet overlap between consecutive days was
//     ZERO for 14 straight days because nobody re-signs-in.
//   - `dev_` accounts take a branch that issues no cookie at all, ever.
//   - Upper bound from /api/stats/retention on 2026-09-16: 55 sign_in events in
//     the last 7 days against 494 registered users. So at most ~11% of users
//     could hold a valid cookie right now.
//
// ORDER OF OPERATIONS, and none of it is a code-only change:
//   1. Read session_authed vs session_anon (instrumented in ownershipError
//      below) for a day. That turns the 11% bound into a measured rate.
//   2. Give a returning user a way to re-establish a cookie without a manual
//      re-install: a session check on load, or re-auth when the cookie is absent.
//   3. Confirm SESSION_SECRET (or ADMIN_SECRET) is actually set in the Vercel
//      environment. If neither is set, `secret()` returns null, no cookie can
//      ever be issued, and enforcing would close every gated route to everybody.
//   4. Only then flip, and watch the shadow counters.
export function sessionEnforced(): boolean {
  return process.env.SESSION_ENFORCE === "true";
}

// For a mutating route: when enforcement is on, require the caller's session
// cookie to match the wallet address they claim to act as. Returns an error
// string to return as 403, or null when the request may proceed.
export function ownershipError(req: NextRequest, claimedAddress: unknown, nowMs: number): string | null {
  const authed = getAuthedAddress(req, nowMs);
  // SHADOW COUNTER, added 2026-09-16. This is the measurement that has to exist
  // before SESSION_ENFORCE can be flipped, and its absence is why the flip has
  // never been safe to make.
  //
  // The cookie is issued ONLY inside /api/verify-identity, only on a verified
  // SIWE signature, and it lives 7 days. page.tsx short-circuits on a stored
  // localStorage id, so a returning user never re-signs-in and never refreshes
  // it. retention.ts records the same thing measured against prod on 2026-07-29:
  // "visitors:<d> ∩ visitors:<d-1> was ZERO for 14 straight days". So an unknown
  // and probably large share of live callers carry no session at all, and
  // enforcing without knowing that share locks them out of nine routes.
  //
  // `authed` here is the honest per-request answer. Read
  // session_authed vs session_anon over a day and the flip becomes a decision
  // with a number under it instead of a hope.
  trackEvent(authed ? "session_authed" : "session_anon", {
    path: req.nextUrl?.pathname ?? "?",
    enforced: sessionEnforced(),
  }).catch(() => {});
  // Shadow audit — runs even while enforcement is OFF: a session cookie that is
  // present but does NOT match the wallet the request claims to act as is a
  // definite spoof attempt (someone acting as another wallet). Log it so abuse
  // is visible before SESSION_ENFORCE is flipped on. A missing cookie is normal
  // pre-enforcement (returning users haven't re-authenticated yet), so it is not
  // treated as abuse here.
  if (authed && !addressMatches(authed, claimedAddress)) {
    console.warn(
      `[session] OWNERSHIP MISMATCH cookie=${authed} claimed=${String(claimedAddress).toLowerCase()} enforced=${sessionEnforced()} path=${req.nextUrl?.pathname ?? "?"}`
    );
  }
  if (!sessionEnforced()) return null;
  if (!authed) return "Please re-open the app to re-authenticate before this action.";
  if (!addressMatches(authed, claimedAddress)) return "Session does not match the wallet for this action.";
  return null;
}
