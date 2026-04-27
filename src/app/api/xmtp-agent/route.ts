import { NextRequest, NextResponse } from "next/server";
import { processAgentQuery } from "@/lib/xmtp-agent";

const AGENT_API_KEY = process.env.AGENT_API_KEY;

function checkAuth(req: NextRequest): boolean {
  if (!AGENT_API_KEY) return false;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const token = auth.replace("Bearer ", "");
  return token === AGENT_API_KEY;
}

function isInAppRequest(req: NextRequest): boolean {
  const referer = req.headers.get("referer") || "";
  const origin = req.headers.get("origin") || "";
  const host = req.headers.get("host") || "";
  return referer.includes(host) || origin.includes(host);
}

export async function POST(req: NextRequest) {
  if (!isInAppRequest(req) && !checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { query, history } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Missing required field: query (string)" },
        { status: 400 },
      );
    }

    // history is optional: Array<{ role: "user" | "assistant"; content: string }>
    const conversationHistory = Array.isArray(history) ? history : undefined;
    const response = await processAgentQuery(query, conversationHistory);

    return NextResponse.json({
      response,
      sender: body.sender || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[XMTP Agent API] Error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
