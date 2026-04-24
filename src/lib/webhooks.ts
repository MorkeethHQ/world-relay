import type { Task } from "./types";

type WebhookEvent = "task.completed" | "task.failed" | "task.flagged";

function resolveEvent(task: Task): WebhookEvent | null {
  if (task.status === "completed") return "task.completed";
  if (task.verificationResult?.verdict === "fail") return "task.failed";
  if (task.verificationResult?.verdict === "flag") return "task.flagged";
  return null;
}

export async function fireWebhook(task: Task): Promise<void> {
  if (!task.callbackUrl) return;

  const event = resolveEvent(task);
  if (!event) return;

  const payload = {
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
  };

  try {
    await fetch(task.callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // fire-and-forget: swallow errors silently
  }
}
