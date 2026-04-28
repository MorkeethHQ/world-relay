import { NextRequest, NextResponse } from "next/server";
import { getEscrowState } from "@/lib/escrow";

const AGENT_API_KEY = process.env.AGENT_API_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")?.replace("Bearer ", "");
  if (auth !== AGENT_API_KEY && auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = await getEscrowState();
  const canFund = auth === ADMIN_SECRET;

  return NextResponse.json({
    walletBalance: `$${state.walletBalance} USDC`,
    escrowLocked: `$${state.escrowBalance} USDC`,
    tasksOnChain: state.taskCount,
    walletAddress: state.walletAddress,
    canAutoFund: canFund,
    maxPerTask: canFund ? 50 : 0,
  });
}
