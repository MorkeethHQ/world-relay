/**
 * MiniKit deep integration helpers — haptics, share, pay.
 *
 * Every helper is guarded so it's safe to call outside World App
 * (falls back to web APIs or no-ops).
 */

import { MiniKit } from "@worldcoin/minikit-js";
import { worldAppUrl } from "./world-app-link";

// ---------------------------------------------------------------------------
// Guard: is MiniKit available in this context?
// ---------------------------------------------------------------------------

function isMiniKitReady(): boolean {
  return typeof window !== "undefined" && MiniKit.isInstalled();
}

function trackDistributionEvent(event: "task_share_opened" | "invite_share_opened"): void {
  if (typeof window === "undefined") return;
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
  }).catch(() => {});
}

function shared(event: "task_share_opened" | "invite_share_opened"): true {
  trackDistributionEvent(event);
  return true;
}

// ---------------------------------------------------------------------------
// Haptic Feedback
// ---------------------------------------------------------------------------

type HapticStyle =
  | { type: "notification"; style: "success" | "error" | "warning" }
  | { type: "impact"; style: "light" | "medium" | "heavy" }
  | { type: "selection" };

/**
 * Fire haptic feedback in World App. Falls back to Vibration API
 * in other webviews that support it.
 */
export async function triggerHaptic(haptic: HapticStyle): Promise<void> {
  try {
    if (isMiniKitReady()) {
      if (haptic.type === "notification") {
        await MiniKit.sendHapticFeedback({
          hapticsType: "notification",
          style: haptic.style,
        });
      } else if (haptic.type === "impact") {
        await MiniKit.sendHapticFeedback({
          hapticsType: "impact",
          style: haptic.style,
        });
      } else {
        await MiniKit.sendHapticFeedback({
          hapticsType: "selection-changed",
        });
      }
      return;
    }

    // Web Vibration API fallback (works in some mobile browsers)
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      const pattern =
        haptic.type === "notification"
          ? haptic.style === "success"
            ? [40, 30, 40]
            : haptic.style === "error"
            ? [60, 40, 60, 40, 60]
            : [50, 30, 50]
          : haptic.type === "impact"
          ? haptic.style === "heavy"
            ? [60]
            : haptic.style === "medium"
            ? [40]
            : [20]
          : [10];
      navigator.vibrate(pattern);
    }
  } catch {
    // Never let haptics crash the app
  }
}

// Convenient shortcuts
export const hapticSuccess = () =>
  triggerHaptic({ type: "notification", style: "success" });
export const hapticError = () =>
  triggerHaptic({ type: "notification", style: "error" });
export const hapticWarning = () =>
  triggerHaptic({ type: "notification", style: "warning" });
export const hapticTap = () =>
  triggerHaptic({ type: "impact", style: "light" });
export const hapticMedium = () =>
  triggerHaptic({ type: "impact", style: "medium" });
export const hapticHeavy = () =>
  triggerHaptic({ type: "impact", style: "heavy" });
export const hapticSelection = () =>
  triggerHaptic({ type: "selection" });

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

export interface ShareTaskOptions {
  taskDescription: string;
  bountyUsdc: number;
  // Reward kind so share copy never claims "$ USDC" for a points task. When
  // "points" (or unfunded), the amount renders as points, not dollars.
  rewardType?: "points" | "usdc" | "usdc-v2";
  funded?: boolean;
  verdict?: string;
  taskId: string;
}

/**
 * Share a completed (or any) task via MiniKit share or Web Share API.
 * Returns true if the share dialog was opened successfully.
 */
export async function shareTask(opts: ShareTaskOptions): Promise<boolean> {
  const { taskDescription, bountyUsdc, rewardType, funded, verdict, taskId } = opts;

  // Real money only when it's a USDC task actually escrow-funded; otherwise the
  // reward is points and must never be shared as dollars.
  const isMoney = rewardType !== "points" && funded !== false;
  const reward = isMoney ? `$${bountyUsdc} USDC` : `${Math.round(bountyUsdc)} pts`;
  const desc = `${taskDescription.slice(0, 80)}${taskDescription.length > 80 ? "..." : ""}`;

  // FAVOUR, not RELAY (renamed 2026-07-02). This is the share-sheet title — the one
  // string in the app that LEAVES it — so the dead name here was broadcasting rot on
  // the distribution surface itself. Copy-only rename; the escrow address and
  // NEXT_PUBLIC_WORLD_APP_ID stay frozen.
  const title = verdict === "pass"
    ? `Earned ${reward} on FAVOUR`
    : `${reward} task on FAVOUR`;

  const text = verdict === "pass"
    ? `I earned ${reward} because an AI agent needed a human: "${desc}"`
    : `This AI agent is offering ${reward} for a human to help: "${desc}"`;

  const path = `/task/${encodeURIComponent(taskId)}`;
  const url = worldAppUrl(path) ?? (
    typeof window !== "undefined" ? `${window.location.origin}${path}` : ""
  );

  try {
    if (isMiniKitReady()) {
      await MiniKit.share({ title, text, url });
      await hapticSuccess();
      return shared("task_share_opened");
    }

    // Web Share API fallback
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title, text, url });
      return shared("task_share_opened");
    }

    // Clipboard fallback
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      return shared("task_share_opened");
    }
  } catch {
    // User cancelled or API not available
  }
  return false;
}

/**
 * Share a referral invite. The ?ref= wallet rides the link into the landing
 * page and attributes the invitee at first sign-in (src/lib/referral.ts).
 */
export async function shareInvite(userId: string): Promise<boolean> {
  const title = "FAVOUR — earn for real-world favours";
  const text = "Join me on FAVOUR: verified humans do small real-world favours and earn. We both get points when you complete your first one.";
  const path = `/?ref=${encodeURIComponent(userId)}`;
  const url = worldAppUrl(path) ?? (
    typeof window !== "undefined" ? `${window.location.origin}${path}` : ""
  );

  try {
    if (isMiniKitReady()) {
      await MiniKit.share({ title, text, url });
      await hapticSuccess();
      return shared("invite_share_opened");
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title, text, url });
      return shared("invite_share_opened");
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      return shared("invite_share_opened");
    }
  } catch {
    // User cancelled or API not available
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pay (direct MiniKit.pay, separate from sendTransaction escrow)
// ---------------------------------------------------------------------------

export interface DirectPayOptions {
  to: string;
  amountUsdc: string;
  description: string;
  reference?: string;
}

/**
 * Trigger a direct MiniKit.pay() payment (World App native pay sheet).
 * This is distinct from sendTransaction — it opens the World App payment UI
 * with USDC token selection already filled in.
 *
 * Returns the pay result or null if unavailable / user cancelled.
 */
export async function directPay(opts: DirectPayOptions) {
  if (!isMiniKitReady()) return null;

  const { Tokens } = await import("@worldcoin/minikit-js/commands");
  const reference = opts.reference || crypto.randomUUID();

  try {
    const result = await MiniKit.pay({
      reference,
      to: opts.to,
      tokens: [{ symbol: Tokens.USDC, token_amount: opts.amountUsdc }],
      description: opts.description,
    });

    if (result) {
      await hapticSuccess();
    }
    return result;
  } catch {
    await hapticError();
    return null;
  }
}

/**
 * Check if MiniKit.pay() is available (only in World App).
 */
export function isPayAvailable(): boolean {
  return isMiniKitReady();
}
