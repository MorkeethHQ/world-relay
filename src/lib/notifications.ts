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

export async function notifyVerified(
  claimantAddress: string,
  bountyUsdc: number,
  rewardType: "points" | "usdc" | "usdc-v2" = "usdc"
): Promise<void> {
  const isPoints = rewardType === "points";
  await sendNotification(
    [claimantAddress],
    isPoints ? "Verified! Points Awarded" : "Verified! Payment Ready",
    isPoints
      ? `Your proof was verified. ${Math.round(bountyUsdc)} points awarded.`
      : `Your proof was verified. $${bountyUsdc} USDC ready for release.`,
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

// World's send-notification endpoint accepts at most 1000 addresses per call.
const MAX_ADDRESSES_PER_CALL = 1000;

// "A new question is live" — the comeback hook of the daily loop. Batched;
// returns how many addresses were in successfully-sent batches. Callers gate
// this behind DAILY_NOTIFY_ENFORCE (see lib/daily-notify.ts) — the transport
// itself stays dumb.
export async function notifyNewDaily(addresses: string[], question: string): Promise<number> {
  let sent = 0;
  for (let i = 0; i < addresses.length; i += MAX_ADDRESSES_PER_CALL) {
    const chunk = addresses.slice(i, i + MAX_ADDRESSES_PER_CALL);
    const ok = await sendNotification(
      chunk,
      "Today's favour is live",
      `The world is answering: "${question.slice(0, 120)}" — 30 seconds, then see the reveal.`,
      "/"
    );
    if (ok) sent += chunk.length;
  }
  return sent;
}

// Per-address because the message carries the streak number — the loss frame
// ("ends at midnight") is the whole reason this notification earns its slot.
export async function notifyStreakAtRisk(address: string, streak: number): Promise<boolean> {
  return sendNotification(
    [address],
    "Your streak ends at midnight",
    `${streak} day${streak === 1 ? "" : "s"} straight. Today's favour takes 30 seconds — keep it alive.`,
    "/"
  );
}

export async function notifyClaimReminder(
  claimantAddress: string,
  taskDescription: string,
  bountyUsdc: number,
  rewardType: "points" | "usdc" | "usdc-v2" = "usdc"
): Promise<void> {
  const reward = rewardType === "points" ? `${Math.round(bountyUsdc)} points` : `$${bountyUsdc} USDC`;
  await sendNotification(
    [claimantAddress],
    "Don't forget your favour!",
    `Submit proof for "${taskDescription.slice(0, 100)}" to earn ${reward}.`,
    "/"
  );
}
