/**
 * MiniKit deep integration helpers — haptics, share, pay.
 *
 * Every helper is guarded so it's safe to call outside World App
 * (falls back to web APIs or no-ops).
 */

import { MiniKit } from "@worldcoin/minikit-js";

// ---------------------------------------------------------------------------
// Guard: is MiniKit available in this context?
// ---------------------------------------------------------------------------

function isMiniKitReady(): boolean {
  return typeof window !== "undefined" && MiniKit.isInstalled();
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
  verdict?: string;
  taskId: string;
}

/**
 * Share a completed (or any) task via MiniKit share or Web Share API.
 * Returns true if the share dialog was opened successfully.
 */
export async function shareTask(opts: ShareTaskOptions): Promise<boolean> {
  const { taskDescription, bountyUsdc, verdict, taskId } = opts;

  const title = verdict === "pass"
    ? `Verified task on RELAY FAVOURS`
    : `Task on RELAY FAVOURS`;

  const text = verdict === "pass"
    ? `I just completed and verified a $${bountyUsdc} USDC task on RELAY FAVOURS: "${taskDescription.slice(0, 80)}${taskDescription.length > 80 ? "..." : ""}"`
    : `Check out this $${bountyUsdc} USDC task on RELAY FAVOURS: "${taskDescription.slice(0, 80)}${taskDescription.length > 80 ? "..." : ""}"`;

  const url = typeof window !== "undefined"
    ? `${window.location.origin}/task/${taskId}`
    : "";

  try {
    if (isMiniKitReady()) {
      await MiniKit.share({ title, text, url });
      await hapticSuccess();
      return true;
    }

    // Web Share API fallback
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title, text, url });
      return true;
    }

    // Clipboard fallback
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      return true;
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
