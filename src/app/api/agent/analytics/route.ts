import { NextRequest, NextResponse } from "next/server";
import { getAgentAnalytics, getPlatformStats } from "@/lib/agent-analytics";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get("agent_id") || undefined;

    const [agents, platform] = await Promise.all([
      getAgentAnalytics(agentId),
      getPlatformStats(),
    ]);

    return NextResponse.json({ agents, platform });
  } catch (error) {
    console.error("[Analytics] Error:", error);
    return NextResponse.json(
      { error: "Failed to compute analytics" },
      { status: 500 }
    );
  }
}
