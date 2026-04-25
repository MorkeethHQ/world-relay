import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

interface DmMessage {
  sender: string;
  text: string;
  timestamp: string;
}

interface DmConversation {
  conversationId: string;
  messages: DmMessage[];
  lastActivity: string;
}

export async function GET() {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ conversations: [], totalDmCount: 0 });
  }

  try {
    // Get all tracked DM conversation IDs
    const conversationIds = await redis.smembers("xmtp:dm_conversations");
    if (!conversationIds || conversationIds.length === 0) {
      const totalDmCount = await redis.get("xmtp:dm_count");
      return NextResponse.json({
        conversations: [],
        totalDmCount: Number(totalDmCount) || 0,
      });
    }

    // Fetch all conversation histories in parallel
    const pipeline = redis.pipeline();
    for (const id of conversationIds) {
      pipeline.get(`xmtp:dm:${id}`);
    }
    const results = await pipeline.exec();

    const conversations: DmConversation[] = [];

    for (let i = 0; i < conversationIds.length; i++) {
      const raw = results[i];
      if (!raw) continue;

      const messages: DmMessage[] =
        typeof raw === "string" ? JSON.parse(raw) : (raw as DmMessage[]);

      if (messages.length === 0) continue;

      const lastMessage = messages[messages.length - 1];
      conversations.push({
        conversationId: String(conversationIds[i]),
        messages,
        lastActivity: lastMessage.timestamp,
      });
    }

    // Sort by most recent first
    conversations.sort(
      (a, b) =>
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );

    // Limit to last 50 messages across all conversations
    let totalMessages = 0;
    const trimmedConversations: DmConversation[] = [];

    for (const conv of conversations) {
      if (totalMessages >= 50) break;

      const remaining = 50 - totalMessages;
      const trimmedMessages = conv.messages.slice(-remaining);
      trimmedConversations.push({
        ...conv,
        messages: trimmedMessages,
      });
      totalMessages += trimmedMessages.length;
    }

    const totalDmCount = await redis.get("xmtp:dm_count");

    return NextResponse.json({
      conversations: trimmedConversations,
      totalDmCount: Number(totalDmCount) || 0,
    });
  } catch (err) {
    console.error("[DM History API] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch DM history" },
      { status: 500 }
    );
  }
}
