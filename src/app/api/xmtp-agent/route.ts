import { NextRequest, NextResponse } from "next/server";
import { processAgentQuery } from "@/lib/xmtp-agent";

const AGENT_API_KEY = process.env.AGENT_API_KEY;

function checkAuth(req: NextRequest): boolean {
  if (!AGENT_API_KEY) return true;
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  const token = auth.replace("Bearer ", "");
  return token === AGENT_API_KEY;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const query = body.query;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Missing required field: query (string)" },
        { status: 400 },
      );
    }

    const response = await processAgentQuery(query);

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
