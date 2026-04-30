import type { Task } from "./types";

type WebhookEvent =
  | "task.completed"
  | "task.failed"
  | "task.flagged"
  | "task.claimed"
  | "task.cancelled";

type WebhookPayload = {
  event: WebhookEvent;
  task_id: string;
  status: string;
  verification: {
    verdict: string;
    reasoning: string;
    confidence: number;
  } | null;
  proof_image_url: string | null;
  claimant: string | null;
  attestation_tx_hash: string | null;
  timestamp: string;
  delivery_id: string;
};

type WebhookResult = {
  delivered: boolean;
  attempts: number;
  statusCode: number | null;
};

const RETRY_DELAYS_MS = [0, 2_000, 8_000] as const;

function resolveEvent(task: Task): WebhookEvent | null {
  if (task.status === "completed") return "task.completed";
  if (task.status === "claimed") return "task.claimed";
  if (task.status === "cancelled") return "task.cancelled";
  if (task.verificationResult?.verdict === "fail") return "task.failed";
  if (task.verificationResult?.verdict === "flag") return "task.flagged";
  return null;
}

function isSafeUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("172.") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "169.254.169.254"
  ) {
    return false;
  }
  return true;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signPayload(
  body: string,
  timestamp: number,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = `${timestamp}.${body}`;
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return `sha256=${toHex(sig)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverWithRetries(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<WebhookResult> {
  let lastStatusCode: number | null = null;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay > 0) {
      await sleep(delay);
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(5_000),
      });

      lastStatusCode = response.status;

      if (response.ok) {
        return { delivered: true, attempts: attempt + 1, statusCode: lastStatusCode };
      }
    } catch {
      // Network error or timeout — will retry if attempts remain
    }
  }

  console.error(
    `[webhook] delivery failed after ${RETRY_DELAYS_MS.length} attempts to ${url} (last status: ${lastStatusCode})`,
  );

  return {
    delivered: false,
    attempts: RETRY_DELAYS_MS.length,
    statusCode: lastStatusCode,
  };
}

export async function fireWebhook(task: Task): Promise<WebhookResult | null> {
  if (!task.callbackUrl) return null;
  if (!isSafeUrl(task.callbackUrl)) return null;

  const event = resolveEvent(task);
  if (!event) return null;

  const deliveryId = crypto.randomUUID();
  const now = new Date();

  const payload: WebhookPayload = {
    event,
    task_id: task.id,
    status: task.status,
    verification: task.verificationResult
      ? {
          verdict: task.verificationResult.verdict,
          reasoning: task.verificationResult.reasoning,
          confidence: task.verificationResult.confidence,
        }
      : null,
    proof_image_url: task.proofImageUrl,
    claimant: task.claimant,
    attestation_tx_hash: task.attestationTxHash,
    timestamp: now.toISOString(),
    delivery_id: deliveryId,
  };

  const body = JSON.stringify(payload);
  const timestampSeconds = Math.floor(now.getTime() / 1_000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Relay-Timestamp": String(timestampSeconds),
    "X-Relay-Delivery": deliveryId,
  };

  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    headers["X-Relay-Signature"] = await signPayload(body, timestampSeconds, secret);
  }

  // First attempt is awaited inline; if it fails, retries continue asynchronously
  // so we don't block the main request for the full backoff sequence.
  try {
    const response = await fetch(task.callbackUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(5_000),
    });

    if (response.ok) {
      return { delivered: true, attempts: 1, statusCode: response.status };
    }
  } catch {
    // First attempt failed — fall through to async retries
  }

  // Schedule remaining retries (attempts 2 and 3) without blocking
  const asyncRetry = (async () => {
    for (let attempt = 1; attempt < RETRY_DELAYS_MS.length; attempt++) {
      await sleep(RETRY_DELAYS_MS[attempt]);

      try {
        const response = await fetch(task.callbackUrl!, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(5_000),
        });

        if (response.ok) {
          return;
        }
      } catch {
        // Will retry if attempts remain
      }
    }

    console.error(
      `[webhook] delivery failed after ${RETRY_DELAYS_MS.length} attempts to ${task.callbackUrl}`,
    );
  })();

  // Prevent unhandled rejection if the async retries fail
  asyncRetry.catch(() => {});

  // Return immediately — retries are in-flight
  return { delivered: false, attempts: 1, statusCode: null };
}

// Exported for use in receiver-side verification
export { signPayload, deliverWithRetries };
export type { WebhookEvent, WebhookPayload, WebhookResult };
