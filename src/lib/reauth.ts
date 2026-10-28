import { walletNonce } from "@/lib/wallet-nonce";
// SIGN IN AGAIN, FROM ANY PAGE (14 Oct 2026). The hard session gates answer
// `reauth_required` when the cookie is missing or expired. The home feed could
// recover (Feed onReauth); a favour opened by link (/task/<id>) or the Profile
// card could not, so a person with an expired cookie was stuck there.
//
// One wallet signature, the same exchange the home page uses (page.tsx
// reauthSilently): MiniKit walletAuth, then POST /api/verify-identity, which
// sets a fresh session cookie. Only for the wallet already signed in here.
import { MiniKit } from "@worldcoin/minikit-js";
import { trackReauthOncePerDay } from "./funnel-events";

/** True when a fresh session for `address` was set. Never throws. */
export async function reauthWallet(address: string): Promise<boolean> {
  try {
    if (!MiniKit.isInstalled()) return false;
    trackReauthOncePerDay("reauth_asked");
    const ok = await signAndExchange(address);
    trackReauthOncePerDay(ok ? "reauth_ok" : "reauth_failed");
    return ok;
  } catch {
    trackReauthOncePerDay("reauth_failed");
    return false;
  }
}

async function signAndExchange(address: string): Promise<boolean> {
  try {
    const result = await MiniKit.walletAuth({
      nonce: await walletNonce(),
      statement: "Sign in to FAVOUR",
      expirationTime: new Date(Date.now() + 3600_000),
    });
    const signed = result?.data?.address;
    if (!signed || signed.toLowerCase() !== address.toLowerCase()) return false;
    const res = await fetch("/api/verify-identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: signed, signature: result.data.signature, message: result.data.message }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Whether an answer asks the person to sign in again. Pure. */
export async function needsReauth(res: Response): Promise<boolean> {
  if (res.status !== 401 && res.status !== 403) return false;
  const body = await res.clone().json().catch(() => null);
  return body?.code === "reauth_required";
}

/** Send once; on `reauth_required`, sign in again and send once more. Only
 *  once: a loop would keep asking a person who declined. */
export async function sendWithReauth(
  send: () => Promise<Response>,
  address: string | null,
  reauth: (address: string) => Promise<boolean> = reauthWallet,
): Promise<Response> {
  const res = await send();
  if (!address || !(await needsReauth(res))) return res;
  if (!(await reauth(address))) return res;
  return send();
}

/** On opening a page: if the session is gone, sign in again once. True when
 *  a session is there afterwards. Same check the home page makes on load
 *  (page.tsx, GET /api/session). Never throws. */
export async function ensureSession(address: string | null, reauth: (address: string) => Promise<boolean> = reauthWallet): Promise<boolean> {
  if (!address) return false;
  try {
    const res = await fetch("/api/session", { cache: "no-store" });
    const s = await res.json().catch(() => null);
    // Only a session for THIS wallet counts (Codex, 14 Oct 2026): another
    // wallet's session on this device would act in the wrong name.
    if (s?.authenticated && typeof s.address === "string" && s.address.toLowerCase() === address.toLowerCase()) return true;
  } catch { /* fall through to a signature */ }
  return reauth(address);
}
