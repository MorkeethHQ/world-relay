import type { Task } from "./types";
import { addMessage } from "./messages";

export type XmtpThreadInfo = {
  conversationId: string;
  posterAddress: string;
  claimantAddress: string;
};

const threadMap = new Map<string, XmtpThreadInfo>();

export async function createTaskThread(
  task: Task,
  claimantAddress: string
): Promise<XmtpThreadInfo | null> {
  if (!process.env.XMTP_WALLET_KEY) {
    const stub: XmtpThreadInfo = {
      conversationId: `stub_${task.id}`,
      posterAddress: task.poster,
      claimantAddress,
    };
    threadMap.set(task.id, stub);
    return stub;
  }

  // Real XMTP integration — create a group conversation
  // between poster, claimant, and the RELAY bot
  try {
    const { Client } = await import("@xmtp/browser-sdk");

    // For now, store the thread info for the task
    const thread: XmtpThreadInfo = {
      conversationId: `xmtp_${task.id}`,
      posterAddress: task.poster,
      claimantAddress,
    };
    threadMap.set(task.id, thread);
    return thread;
  } catch {
    const stub: XmtpThreadInfo = {
      conversationId: `stub_${task.id}`,
      posterAddress: task.poster,
      claimantAddress,
    };
    threadMap.set(task.id, stub);
    return stub;
  }
}

export async function postToThread(
  taskId: string,
  message: string
): Promise<boolean> {
  const thread = threadMap.get(taskId);
  if (!thread) return false;

  addMessage(taskId, "relay-bot", message);

  if (thread.conversationId.startsWith("stub_")) {
    console.log(`[XMTP stub] ${taskId}: ${message}`);
    return true;
  }

  try {
    console.log(`[XMTP] ${taskId}: ${message}`);
    return true;
  } catch {
    return false;
  }
}

export function getThread(taskId: string): XmtpThreadInfo | undefined {
  return threadMap.get(taskId);
}

export async function postClaimNotification(task: Task, claimantAddress: string): Promise<void> {
  await createTaskThread(task, claimantAddress);
  await postToThread(task.id, [
    `Task claimed: "${task.description}"`,
    `Location: ${task.location}`,
    `Bounty: $${task.bountyUsdc} USDC`,
    `Claimant: ${claimantAddress}`,
    `Submit your proof photo to complete this task.`,
  ].join("\n"));
}

export async function postProofSubmitted(taskId: string): Promise<void> {
  await postToThread(taskId, "Proof submitted. AI verification in progress...");
}

export async function postVerificationResult(
  taskId: string,
  verdict: "pass" | "flag" | "fail",
  reasoning: string,
  bountyUsdc: number
): Promise<void> {
  if (verdict === "pass") {
    await postToThread(taskId, [
      "VERIFIED — Proof accepted.",
      `Reason: ${reasoning}`,
      `$${bountyUsdc} USDC released to claimant.`,
    ].join("\n"));
  } else if (verdict === "flag") {
    await postToThread(taskId, [
      "FLAGGED — Needs poster review.",
      `Reason: ${reasoning}`,
      "Poster: confirm or reject this proof.",
    ].join("\n"));
  } else {
    await postToThread(taskId, [
      "FAILED — Proof rejected.",
      `Reason: ${reasoning}`,
      "Task reopened for new claims.",
    ].join("\n"));
  }
}
