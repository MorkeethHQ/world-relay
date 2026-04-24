import type { Task } from "./types";
import { addMessage } from "./messages";

let xmtpClient: any = null;
let clientInitPromise: Promise<any> | null = null;

async function getXmtpClient() {
  if (xmtpClient) return xmtpClient;
  if (clientInitPromise) return clientInitPromise;

  const walletKey = process.env.XMTP_WALLET_KEY;
  if (!walletKey) return null;

  clientInitPromise = (async () => {
    try {
      const { Client } = await import("@xmtp/node-sdk");
      const { privateKeyToAccount } = await import("viem/accounts");
      const { getRandomValues } = await import("node:crypto");

      const key = walletKey.startsWith("0x") ? walletKey : `0x${walletKey}`;
      const account = privateKeyToAccount(key as `0x${string}`);

      const signer = {
        type: "EOA" as const,
        getIdentifier: () => ({
          identifier: account.address.toLowerCase(),
          identifierKind: 0 as const, // IdentifierKind.Ethereum
        }),
        signMessage: async (message: string) => {
          const sig = await account.signMessage({ message });
          return Buffer.from(sig.slice(2), "hex");
        },
      };

      const dbEncryptionKey = getRandomValues(new Uint8Array(32));
      const client = await Client.create(signer, {
        dbEncryptionKey,
        env: "production",
      });

      xmtpClient = client;
      console.log("[XMTP] Client initialized. Inbox:", client.inboxId);
      return client;
    } catch (err) {
      console.error("[XMTP] Failed to initialize client:", err);
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
  const thread = threadMap.get(taskId);
  if (!thread) return false;

  await addMessage(taskId, sender, message);

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

export async function getXmtpStatus(): Promise<{
  connected: boolean;
  inboxId: string | null;
  address: string | null;
}> {
  const client = await getXmtpClient();
  if (!client) return { connected: false, inboxId: null, address: null };
  return {
    connected: true,
    inboxId: client.inboxId,
    address: client.accountIdentifier?.identifier || null,
  };
}
