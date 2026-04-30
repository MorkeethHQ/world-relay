import { NextRequest, NextResponse } from "next/server";
import { getEscrowState } from "@/lib/escrow";
import { checkAgentAuth } from "@/lib/api-keys";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

export async function GET(req: NextRequest) {
  const authResult = await checkAgentAuth(req);
  const rawToken = req.headers.get("authorization")?.replace("Bearer ", "");
  const isAdmin = ADMIN_SECRET && rawToken === ADMIN_SECRET;

  if (!authResult.authenticated && !isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = await getEscrowState();
  const canFund = !!isAdmin;

  return NextResponse.json({
    walletBalance: `$${state.walletBalance} USDC`,
    escrowLocked: `$${state.escrowBalance} USDC`,
    tasksOnChain: state.taskCount,
    walletAddress: state.walletAddress,
    canAutoFund: canFund,
    maxPerTask: canFund ? 50 : 0,
  });
}
