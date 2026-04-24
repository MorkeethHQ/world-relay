import type { Task } from "./types";
import { addMessage } from "./messages";

let xmtpClient: any = null;
let clientInitPromise: Promise<any> | null = null;
let lastInitError: string | null = null;

function deriveEncryptionKey(walletKey: string): Uint8Array {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const hash = createHash("sha256").update(`xmtp-relay-db-key:${walletKey}`).digest();
  return new Uint8Array(hash);
}

async function getXmtpClient() {
  if (xmtpClient) return xmtpClient;
  if (clientInitPromise) return clientInitPromise;

  const walletKey = process.env.XMTP_WALLET_KEY?.trim();
  if (!walletKey) {
    lastInitError = "XMTP_WALLET_KEY not set";
    return null;
  }

  clientInitPromise = (async () => {
    try {
      const { Client } = await import("@xmtp/node-sdk");
      const { privateKeyToAccount } = await import("viem/accounts");

      const cleaned = walletKey.replace(/[^0-9a-fA-Fx]/g, "");
      const key = cleaned.startsWith("0x") ? cleaned : `0x${cleaned}`;
      const account = privateKeyToAccount(key as `0x${string}`);

      const signer = {
        type: "EOA" as const,
        getIdentifier: () => ({
          identifier: account.address.toLowerCase(),
          identifierKind: 0 as const,
        }),
        signMessage: async (message: string) => {
          const sig = await account.signMessage({ message });
          return Buffer.from(sig.slice(2), "hex");
        },
      };

      const dbEncryptionKey = deriveEncryptionKey(walletKey);
      const client = await Client.create(signer, {
        dbEncryptionKey,
        dbPath: `/tmp/xmtp-relay-${account.address.slice(2, 10)}.db`,
        env: "production",
      });

      xmtpClient = client;
      lastInitError = null;
      console.log("[XMTP] Client initialized. Inbox:", client.inboxId);
      return client;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[XMTP] Failed to initialize client:", msg);
      lastInitError = msg;
      clientInitPromise = null;
      return null;
    }
  })();

  return clientInitPromise;
}

export type XmtpThreadInfo = {
  conversationId: string;
  posterAddress: string;
  claimantAddress: string;
  groupId?: string;
};

const threadMap = new Map<string, XmtpThreadInfo>();

async function sendXmtpMessage(thread: XmtpThreadInfo, message: string): Promise<boolean> {
  const client = await getXmtpClient();
  if (!client || !thread.groupId) return false;

  try {
    await client.conversations.sync();
    const conversations = await client.conversations.list();
    const group = conversations.find((c: any) => c.id === thread.groupId);
    if (group) {
      await group.sendText(message);
      console.log(`[XMTP] Sent to group ${thread.groupId}: ${message.slice(0, 60)}...`);
      return true;
    }
  } catch (err) {
    console.error("[XMTP] Failed to send message:", err);
  }
  return false;
}

export async function createTaskThread(
  task: Task,
  claimantAddress: string
): Promise<XmtpThreadInfo | null> {
  const client = await getXmtpClient();

  const thread: XmtpThreadInfo = {
    conversationId: `xmtp_${task.id}`,
    posterAddress: task.poster,
    claimantAddress,
  };

  if (client) {
    try {
      const group = await client.conversations.createGroup([], {
        groupName: `RELAY: ${task.description.slice(0, 50)}`,
        groupDescription: `Task ${task.id} — $${task.bountyUsdc} USDC at ${task.location}`,
      });
      thread.groupId = group.id;
      console.log(`[XMTP] Created group ${group.id} for task ${task.id}`);
    } catch (err) {
      console.error("[XMTP] Failed to create group:", err);
    }
  }

  threadMap.set(task.id, thread);
  return thread;
}

export async function postToThread(
  taskId: string,
  message: string
): Promise<boolean> {
  const thread = threadMap.get(taskId);
  if (!thread) return false;

  await addMessage(taskId, "relay-bot", message);

  const sent = await sendXmtpMessage(thread, message);
  if (!sent) {
    console.log(`[XMTP] Message stored locally for task ${taskId}`);
  }
  return true;
}

export async function postUserMessage(
  taskId: string,
  sender: string,
  message: string
): Promise<boolean> {
  await addMessage(taskId, sender, message);

  const thread = threadMap.get(taskId);
  if (!thread) return false;

  const prefixed = `[${sender.startsWith("0x") ? `${sender.slice(0, 6)}...${sender.slice(-4)}` : sender}]: ${message}`;
  await sendXmtpMessage(thread, prefixed);
  return true;
}

export function getThread(taskId: string): XmtpThreadInfo | undefined {
  return threadMap.get(taskId);
}

export async function postClaimNotification(task: Task, claimantAddress: string): Promise<void> {
  await createTaskThread(task, claimantAddress);
  await postToThread(task.id, [
    `📋 TASK CLAIMED`,
    `━━━━━━━━━━━━━━━━━━`,
    `"${task.description}"`,
    `📍 ${task.location}`,
    `💰 $${task.bountyUsdc} USDC bounty`,
    `👤 Claimed by ${claimantAddress.startsWith("0x") ? `${claimantAddress.slice(0, 6)}...${claimantAddress.slice(-4)}` : claimantAddress}`,
    ``,
    `Next step: Submit a proof photo showing task completion.`,
    `Both sides verified human via World ID.`,
  ].join("\n"));
}

export async function postProofSubmitted(taskId: string, proofNote?: string | null): Promise<void> {
  await postToThread(taskId, [
    `📸 PROOF SUBMITTED`,
    `━━━━━━━━━━━━━━━━━━`,
    ...(proofNote ? [`Note: "${proofNote}"`] : []),
    `AI verification in progress...`,
    `Powered by Claude Vision on World Chain.`,
  ].join("\n"));
}

export async function postVerificationResult(
  taskId: string,
  verdict: "pass" | "flag" | "fail",
  reasoning: string,
  bountyUsdc: number,
  confidence?: number
): Promise<void> {
  if (verdict === "pass") {
    await postToThread(taskId, [
      `✅ VERIFIED — AI APPROVED`,
      `━━━━━━━━━━━━━━━━━━`,
      `Reasoning: ${reasoning}`,
      ...(confidence ? [`Confidence: ${Math.round(confidence * 100)}%`] : []),
      ``,
      `💸 SETTLEMENT`,
      `$${bountyUsdc} USDC → claimant`,
      `Escrow release on World Chain.`,
    ].join("\n"));
  } else if (verdict === "flag") {
    await postToThread(taskId, [
      `⚠️ FLAGGED — NEEDS HUMAN REVIEW`,
      `━━━━━━━━━━━━━━━━━━`,
      `Reasoning: ${reasoning}`,
      ...(confidence ? [`Confidence: ${Math.round(confidence * 100)}%`] : []),
      ``,
      `Poster: approve or reject this proof.`,
      `$${bountyUsdc} USDC held in escrow.`,
    ].join("\n"));
  } else {
    await postToThread(taskId, [
      `❌ REJECTED — PROOF INSUFFICIENT`,
      `━━━━━━━━━━━━━━━━━━`,
      `Reasoning: ${reasoning}`,
      ``,
      `Task reopened for new claims.`,
      `$${bountyUsdc} USDC returned to escrow.`,
    ].join("\n"));
  }
}

export async function postSettlementConfirmation(
  taskId: string,
  bountyUsdc: number,
  txHash?: string
): Promise<void> {
  await postToThread(taskId, [
    `🔗 ON-CHAIN SETTLEMENT CONFIRMED`,
    `━━━━━━━━━━━━━━━━━━`,
    `$${bountyUsdc} USDC released on World Chain`,
    ...(txHash ? [`Tx: ${txHash}`] : []),
    ``,
    `Task complete. Both parties verified human via World ID.`,
    `Proof verified by AI. Settlement on-chain. Chat via XMTP.`,
  ].join("\n"));
}

export async function postClaimBriefing(taskId: string, briefing: string): Promise<void> {
  await postToThread(taskId, [
    `🤖 AI BRIEFING`,
    `━━━━━━━━━━━━━━━━━━`,
    briefing,
    ``,
    `Submit your proof photo when ready. Good luck!`,
  ].join("\n"));
}

export async function postFollowUpQuestion(taskId: string, question: string, confidence: number): Promise<void> {
  await postToThread(taskId, [
    `🔍 AI FOLLOW-UP`,
    `━━━━━━━━━━━━━━━━━━`,
    `Confidence: ${Math.round(confidence * 100)}% — not enough to auto-verify.`,
    ``,
    question,
    ``,
    `Reply in this thread, then tap "Re-evaluate" for a new verdict.`,
  ].join("\n"));
}

export async function postReEvaluationResult(
  taskId: string,
  verdict: "pass" | "flag" | "fail",
  reasoning: string,
  bountyUsdc: number,
  confidence?: number
): Promise<void> {
  const icon = verdict === "pass" ? "✅" : verdict === "flag" ? "⚠️" : "❌";
  const label = verdict === "pass" ? "VERIFIED (after follow-up)" : verdict === "flag" ? "STILL FLAGGED" : "REJECTED (after follow-up)";
  await postToThread(taskId, [
    `${icon} RE-EVALUATION: ${label}`,
    `━━━━━━━━━━━━━━━━━━`,
    `Reasoning: ${reasoning}`,
    ...(confidence ? [`Confidence: ${Math.round(confidence * 100)}%`] : []),
    ``,
    ...(verdict === "pass" ? [
      `💸 SETTLEMENT`,
      `$${bountyUsdc} USDC → claimant`,
      `Escrow release on World Chain.`,
    ] : verdict === "flag" ? [
      `Poster: approve or reject this proof manually.`,
    ] : [
      `Task reopened for new claims.`,
    ]),
  ].join("\n"));
}

export async function postDisputeVerdict(
  taskId: string,
  approved: boolean,
  reasoning: string,
  bountyUsdc: number,
  confidence: number
): Promise<void> {
  await postToThread(taskId, [
    `⚖️ AI DISPUTE RESOLUTION`,
    `━━━━━━━━━━━━━━━━━━`,
    `After reviewing all evidence and conversation:`,
    ``,
    `Reasoning: ${reasoning}`,
    `Confidence: ${Math.round(confidence * 100)}%`,
    ``,
    approved
      ? `✅ VERDICT: APPROVED\n$${bountyUsdc} USDC → claimant. Escrow released.`
      : `❌ VERDICT: REJECTED\nTask reopened. $${bountyUsdc} USDC returned to escrow.`,
    ``,
    `This verdict was rendered by AI after analyzing the proof photo, initial verification, and the full XMTP thread.`,
  ].join("\n"));
}

export async function getXmtpStatus(): Promise<{
  connected: boolean;
  inboxId: string | null;
  address: string | null;
  error: string | null;
}> {
  const client = await getXmtpClient();
  if (!client) return { connected: false, inboxId: null, address: null, error: lastInitError };
  return {
    connected: true,
    inboxId: client.inboxId,
    address: client.accountIdentifier?.identifier || null,
    error: null,
  };
}
