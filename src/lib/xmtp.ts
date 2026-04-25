import type { Task } from "./types";
import { addMessage } from "./messages";
import { getRedis } from "./redis";
import { processIncomingMessage } from "./xmtp-commands";
import { processAgentQuery } from "./xmtp-agent";

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

      // Store group-to-task mapping in Redis for sync lookup
      const redis = getRedis();
      if (redis) {
        await redis.set(`xmtp:group:${group.id}`, task.id).catch(console.error);
      }
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
    `Verification in progress...`,
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
      `✅ VERIFIED — APPROVED`,
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
    `📝 BRIEFING`,
    `━━━━━━━━━━━━━━━━━━`,
    briefing,
    ``,
    `Submit your proof photo when ready. Good luck!`,
  ].join("\n"));
}

export async function postFollowUpQuestion(taskId: string, question: string, confidence: number): Promise<void> {
  await postToThread(taskId, [
    `🔍 FOLLOW-UP`,
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// XMTP Message Sync — polls for new inbound messages
// and routes them through the command processor.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const LAST_SYNC_KEY = "xmtp:last_sync";

export async function syncAndProcessMessages(): Promise<{
  messagesProcessed: number;
  conversations: number;
}> {
  const client = await getXmtpClient();
  if (!client) {
    console.warn("[XMTP Sync] Client not available, skipping sync");
    return { messagesProcessed: 0, conversations: 0 };
  }

  const redis = getRedis();
  if (!redis) {
    console.warn("[XMTP Sync] Redis not available, skipping sync");
    return { messagesProcessed: 0, conversations: 0 };
  }

  // Get last sync timestamp
  const lastSyncRaw = await redis.get(LAST_SYNC_KEY);
  const lastSyncNs: bigint = lastSyncRaw ? BigInt(String(lastSyncRaw)) : BigInt(0);

  // Sync all conversations from the network
  await client.conversations.sync();
  const conversations = await client.conversations.list();

  let messagesProcessed = 0;
  let latestTimestampNs: bigint = lastSyncNs;
  const ourInboxId = client.inboxId;

  for (const conversation of conversations) {
    try {
      await conversation.sync();

      // Fetch messages — use opts to filter by sentAfterNs if available
      const allMessages = await conversation.messages();

      for (const msg of allMessages) {
        // Skip messages we already processed (at or before last sync)
        const msgTimestampNs = BigInt(msg.sentAtNs);
        if (msgTimestampNs <= lastSyncNs) continue;

        // Skip our own messages
        if (msg.senderInboxId === ourInboxId) continue;

        // Skip non-text content
        if (msg.contentType?.typeId !== "text" || typeof msg.content !== "string") {
          continue;
        }

        const messageText = msg.content as string;
        if (!messageText.trim()) continue;

        // Track the latest timestamp
        if (msgTimestampNs > latestTimestampNs) {
          latestTimestampNs = msgTimestampNs;
        }

        // Resolve task ID from Redis mapping or in-memory threadMap
        let taskId: string | null = null;

        // Try Redis mapping first
        const redisTaskId = await redis.get(`xmtp:group:${conversation.id}`);
        if (redisTaskId) {
          taskId = String(redisTaskId);
        }

        // Fallback: search in-memory threadMap
        if (!taskId) {
          for (const [tId, info] of threadMap.entries()) {
            if (info.groupId === conversation.id) {
              taskId = tId;
              break;
            }
          }
        }

        if (!taskId) {
          // No task mapping — this is a DM to the bot. Route through the agent query processor.
          console.log(
            `[XMTP Sync] DM received in conversation ${conversation.id} from ${msg.senderInboxId}: "${messageText.slice(0, 60)}"`
          );
          try {
            const dmResponse = await processAgentQuery(messageText);
            if (dmResponse) {
              await conversation.send(dmResponse);
              console.log(
                `[XMTP Sync] Sent DM response to conversation ${conversation.id}`
              );

              // Store both the incoming message and bot response in Redis DM history
              const dmKey = `xmtp:dm:${conversation.id}`;
              const now = new Date().toISOString();
              const incomingEntry = {
                sender: msg.senderInboxId,
                text: messageText,
                timestamp: now,
              };
              const responseEntry = {
                sender: "relay-bot",
                text: dmResponse,
                timestamp: now,
              };

              try {
                const existingRaw = await redis.get(dmKey);
                const existing: Array<{ sender: string; text: string; timestamp: string }> =
                  existingRaw
                    ? typeof existingRaw === "string"
                      ? JSON.parse(existingRaw)
                      : (existingRaw as Array<{ sender: string; text: string; timestamp: string }>)
                    : [];
                existing.push(incomingEntry, responseEntry);
                // Keep last 100 messages per conversation to avoid unbounded growth
                const trimmed = existing.slice(-100);
                await redis.set(dmKey, JSON.stringify(trimmed));

                // Track this conversation ID in a set for easy enumeration
                await redis.sadd("xmtp:dm_conversations", conversation.id);

                // Increment total DM query counter
                await redis.incr("xmtp:dm_count");
              } catch (storeErr) {
                console.error(
                  `[XMTP Sync] Failed to store DM history for conversation ${conversation.id}:`,
                  storeErr
                );
              }
            }
          } catch (dmErr) {
            console.error(
              `[XMTP Sync] Failed to process/send DM response in conversation ${conversation.id}:`,
              dmErr
            );
          }
          messagesProcessed++;
          continue;
        }

        // Use sender inbox ID as the sender identifier
        const sender = msg.senderInboxId;
        console.log(
          `[XMTP Sync] Processing message for task ${taskId} from ${sender}: "${messageText.slice(0, 60)}"`
        );

        // Store the incoming message in the UI message history
        await addMessage(taskId, sender, messageText);

        // Route through the command processor
        const response = await processIncomingMessage(
          taskId,
          sender,
          messageText
        );

        if (response) {
          // Send the bot response back via XMTP
          try {
            await conversation.send(response);
          } catch (sendErr) {
            console.error(
              `[XMTP Sync] Failed to send response to group ${conversation.id}:`,
              sendErr
            );
          }
          // Also store the bot response in UI message history
          await addMessage(taskId, "relay-bot", response);
        }

        messagesProcessed++;
      }
    } catch (convErr) {
      console.error(
        `[XMTP Sync] Error processing conversation ${conversation.id}:`,
        convErr
      );
    }
  }

  // Update last sync timestamp
  if (latestTimestampNs > lastSyncNs) {
    await redis
      .set(LAST_SYNC_KEY, latestTimestampNs.toString())
      .catch(console.error);
  }
  // Always update the human-readable last-sync time
  await redis
    .set("xmtp:last_sync_at", new Date().toISOString())
    .catch(console.error);

  console.log(
    `[XMTP Sync] Done. ${conversations.length} conversations, ${messagesProcessed} new messages processed.`
  );
  return { messagesProcessed, conversations: conversations.length };
}

export async function getXmtpStatus(): Promise<{
  connected: boolean;
  inboxId: string | null;
  address: string | null;
  error: string | null;
  lastSync: string | null;
  conversationCount: number;
}> {
  const client = await getXmtpClient();
  if (!client) {
    return {
      connected: false,
      inboxId: null,
      address: null,
      error: lastInitError,
      lastSync: null,
      conversationCount: 0,
    };
  }

  let lastSync: string | null = null;
  let conversationCount = 0;

  const redis = getRedis();
  if (redis) {
    const syncAt = await redis.get("xmtp:last_sync_at");
    lastSync = syncAt ? String(syncAt) : null;
  }

  try {
    await client.conversations.sync();
    const conversations = await client.conversations.list();
    conversationCount = conversations.length;
  } catch {
    // Non-fatal — just report 0
  }

  return {
    connected: true,
    inboxId: client.inboxId,
    address: client.accountIdentifier?.identifier || null,
    error: null,
    lastSync,
    conversationCount,
  };
}
