import { getTask, claimTask, submitProof } from "./store";
import { postClaimNotification, postClaimBriefing } from "./xmtp";
import { generateClaimBriefing } from "./ai-chat";
import { notifyTaskClaimed } from "./notifications";
import { processAgentQuery } from "./xmtp-agent";
import type { Task } from "./types";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// XMTP Command Router
// Processes incoming chat messages as potential commands
// so runners can claim tasks, submit proofs, and check
// status entirely through XMTP messages.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type Command = "status" | "claim" | "proof" | "help" | null;

function truncateAddress(addr: string): string {
  if (!addr.startsWith("0x") || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function parseCommand(message: string): Command {
  const trimmed = message.trim().toLowerCase();

  // STATUS
  if (trimmed === "?" || trimmed === "status" || trimmed === "status?") {
    return "status";
  }

  // CLAIM
  if (
    trimmed === "claim" ||
    trimmed === "claim it" ||
    trimmed === "i'll do it" ||
    trimmed === "ill do it" ||
    trimmed === "i will do it" ||
    trimmed === "mine" ||
    trimmed === "on it" ||
    trimmed === "i got this" ||
    trimmed === "i'll take it" ||
    trimmed === "ill take it" ||
    trimmed === "take it"
  ) {
    return "claim";
  }

  // PROOF
  if (
    trimmed === "proof" ||
    trimmed === "done" ||
    trimmed === "completed" ||
    trimmed === "submit proof" ||
    trimmed === "here's proof" ||
    trimmed === "heres proof" ||
    trimmed.startsWith("proof:")
  ) {
    return "proof";
  }

  // HELP
  if (trimmed === "help" || trimmed === "commands" || trimmed === "/help") {
    return "help";
  }

  return null;
}

function formatTimeRemaining(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m remaining`;
  return `${mins}m remaining`;
}

function formatStatusResponse(task: Task): string {
  const statusIcon =
    task.status === "open" ? "🟢" :
    task.status === "claimed" ? "🟡" :
    task.status === "completed" ? "✅" : "🔴";

  const lines = [
    `${statusIcon} TASK STATUS`,
    `━━━━━━━━━━━━━━━━━━`,
    `"${task.description}"`,
    ``,
    `📍 Location: ${task.location}`,
    `💰 Bounty: $${task.bountyUsdc} USDC`,
    `📌 Status: ${task.status.toUpperCase()}`,
    `⏰ Deadline: ${formatTimeRemaining(task.deadline)}`,
  ];

  if (task.claimant) {
    lines.push(`👤 Claimed by: ${truncateAddress(task.claimant)}`);
  }

  if (task.verificationResult) {
    const v = task.verificationResult;
    const icon = v.verdict === "pass" ? "✅" : v.verdict === "flag" ? "⚠️" : "❌";
    lines.push(`${icon} Verification: ${v.verdict.toUpperCase()} (${Math.round(v.confidence * 100)}%)`);
  }

  return lines.join("\n");
}

function formatHelpResponse(): string {
  return [
    `🤖 RELAY COMMANDS`,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
    `STATUS or ? — Check current task status`,
    `CLAIM or "I'll do it" — Claim this task`,
    `PROOF (with image) — Submit proof of completion`,
    `HELP — Show this menu`,
    ``,
    `Or just chat — messages are shared with all participants.`,
  ].join("\n");
}

/**
 * Process an incoming user message and route it to the
 * appropriate command handler.
 *
 * Returns a formatted bot response string if the message
 * was a command, or null if it was a regular chat message.
 */
export async function processIncomingMessage(
  taskId: string,
  sender: string,
  message: string,
  imageBase64?: string
): Promise<string | null> {
  const command = parseCommand(message);

  // Fallback: unrecognized messages go to the XMTP agent for
  // natural-language task discovery (location, bounty, category, etc.)
  if (command === null) {
    return processAgentQuery(message);
  }

  const task = await getTask(taskId);
  if (!task) {
    return [
      `❌ ERROR`,
      `━━━━━━━━━━━━━━━━━━`,
      `Task not found. It may have been removed.`,
    ].join("\n");
  }

  switch (command) {
    case "status":
      return formatStatusResponse(task);

    case "help":
      return formatHelpResponse();

    case "claim":
      return handleClaim(task, sender);

    case "proof":
      return handleProof(task, sender, message, imageBase64);
  }
}

async function handleClaim(task: Task, sender: string): Promise<string> {
  // Already completed
  if (task.status === "completed") {
    return [
      `❌ CANNOT CLAIM`,
      `━━━━━━━━━━━━━━━━━━`,
      `This task is already completed.`,
    ].join("\n");
  }

  // Already claimed
  if (task.status === "claimed") {
    return [
      `❌ CANNOT CLAIM`,
      `━━━━━━━━━━━━━━━━━━`,
      `This task is already claimed by ${truncateAddress(task.claimant || "unknown")}.`,
      `Try another task or wait for it to reopen.`,
    ].join("\n");
  }

  // Poster can't claim own task
  if (task.poster === sender) {
    return [
      `❌ CANNOT CLAIM`,
      `━━━━━━━━━━━━━━━━━━`,
      `You posted this task — you can't claim your own bounty.`,
    ].join("\n");
  }

  // Deadline passed
  if (new Date(task.deadline).getTime() < Date.now()) {
    return [
      `❌ CANNOT CLAIM`,
      `━━━━━━━━━━━━━━━━━━`,
      `This task has expired. The deadline has passed.`,
    ].join("\n");
  }

  // Attempt claim
  const updated = await claimTask(task.id, sender);
  if (!updated) {
    return [
      `❌ CLAIM FAILED`,
      `━━━━━━━━━━━━━━━━━━`,
      `Could not claim this task. It may have just been taken.`,
    ].join("\n");
  }

  // Fire notifications (non-blocking)
  postClaimNotification(updated, sender).catch(console.error);
  notifyTaskClaimed(updated.poster, updated.description).catch(console.error);

  generateClaimBriefing(updated, updated.agent?.id || undefined)
    .then(async (briefing) => {
      if (briefing) await postClaimBriefing(updated.id, briefing);
    })
    .catch(console.error);

  return [
    `✅ TASK CLAIMED`,
    `━━━━━━━━━━━━━━━━━━`,
    `"${updated.description}"`,
    ``,
    `📍 ${updated.location}`,
    `💰 $${updated.bountyUsdc} USDC bounty`,
    `⏰ ${formatTimeRemaining(updated.deadline)}`,
    ``,
    `Next: Complete the task and send PROOF with a photo.`,
  ].join("\n");
}

async function handleProof(
  task: Task,
  sender: string,
  message: string,
  imageBase64?: string
): Promise<string> {
  // Must be claimed
  if (task.status !== "claimed") {
    const hint =
      task.status === "open"
        ? `This task hasn't been claimed yet. Send CLAIM first.`
        : task.status === "completed"
          ? `This task is already completed.`
          : `This task is in ${task.status} status.`;
    return [
      `❌ CANNOT SUBMIT PROOF`,
      `━━━━━━━━━━━━━━━━━━`,
      hint,
    ].join("\n");
  }

  // Must be the claimant
  if (task.claimant !== sender) {
    return [
      `❌ CANNOT SUBMIT PROOF`,
      `━━━━━━━━━━━━━━━━━━`,
      `Only the claimant (${truncateAddress(task.claimant || "unknown")}) can submit proof.`,
    ].join("\n");
  }

  // Must have an image
  if (!imageBase64) {
    return [
      `📸 PROOF NEEDS A PHOTO`,
      `━━━━━━━━━━━━━━━━━━`,
      `Send your proof message with an attached image.`,
      `The AI verifier needs a photo to confirm completion.`,
    ].join("\n");
  }

  // Extract optional note from "proof: <note>" format
  const trimmed = message.trim();
  let proofNote: string | null = null;
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx !== -1 && colonIdx < trimmed.length - 1) {
    proofNote = trimmed.slice(colonIdx + 1).trim() || null;
  }

  // Store the proof image as a data URI
  const proofImageUrl = `data:image/jpeg;base64,${imageBase64}`;

  const updated = await submitProof(task.id, proofImageUrl, proofNote);
  if (!updated) {
    return [
      `❌ PROOF SUBMISSION FAILED`,
      `━━━━━━━━━━━━━━━━━━`,
      `Something went wrong. The task state may have changed.`,
      `Send STATUS to check.`,
    ].join("\n");
  }

  return [
    `📸 PROOF RECEIVED`,
    `━━━━━━━━━━━━━━━━━━`,
    ...(proofNote ? [`Note: "${proofNote}"`] : []),
    ``,
    `AI verification will begin shortly.`,
    `Verification runs on World Chain.`,
    ``,
    `Send STATUS to track the result.`,
  ].join("\n");
}
