const NOTIFICATION_API = "https://developer.worldcoin.org/api/v2/minikit/send-notification";

async function sendNotification(
  walletAddresses: string[],
  title: string,
  message: string,
  path?: string
): Promise<boolean> {
  const apiKey = process.env.WORLD_NOTIFICATION_API_KEY;
  const appId = process.env.NEXT_PUBLIC_WORLD_APP_ID;

  if (!apiKey || !appId) return false;

  const validAddresses = walletAddresses.filter((a) => a.startsWith("0x"));
  if (validAddresses.length === 0) return false;

  try {
    const res = await fetch(NOTIFICATION_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: appId,
        wallet_addresses: validAddresses,
        title: title.slice(0, 30),
        message: message.slice(0, 200),
        ...(path ? { mini_app_path: path } : {}),
      }),
    });

    if (!res.ok) {
      console.error("[Notify] Failed:", await res.text());
      return false;
    }

    return true;
  } catch (err) {
    console.error("[Notify] Error:", err);
    return false;
  }
}

export async function notifyTaskClaimed(posterAddress: string, taskDescription: string): Promise<void> {
  await sendNotification(
    [posterAddress],
    "Task Claimed!",
    `Someone claimed: "${taskDescription.slice(0, 150)}"`,
    "/"
  );
}

export async function notifyProofSubmitted(posterAddress: string, taskDescription: string): Promise<void> {
  await sendNotification(
    [posterAddress],
    "Proof Submitted",
    `Proof received for: "${taskDescription.slice(0, 150)}"`,
    "/"
  );
}

export async function notifyVerified(claimantAddress: string, bountyUsdc: number): Promise<void> {
  await sendNotification(
    [claimantAddress],
    "Verified! Payment Ready",
    `Your proof was verified. $${bountyUsdc} USDC ready for release.`,
    "/"
  );
}

export async function notifyPaymentReleased(claimantAddress: string, bountyUsdc: number): Promise<void> {
  await sendNotification(
    [claimantAddress],
    "Payment Released!",
    `$${bountyUsdc} USDC sent to your wallet on World Chain.`,
    "/"
  );
}

export async function notifyFlagged(posterAddress: string, taskDescription: string): Promise<void> {
  await sendNotification(
    [posterAddress],
    "Review Needed",
    `AI flagged proof for: "${taskDescription.slice(0, 120)}". Please review.`,
    "/"
  );
}
