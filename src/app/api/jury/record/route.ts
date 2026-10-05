import { NextRequest, NextResponse } from "next/server";
import { getAuthedAddress } from "@/lib/session";
import { listTasks } from "@/lib/store";
import { getJudgeStats, isAppealable, isQualifiedJudge } from "@/lib/jury-appeal";
import { houseReviewWaiting } from "@/lib/house-review";

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// GET /api/jury/record -> the signed-in person's graded record, whether their
// decision counts on flagged proofs, and how many flagged proofs wait for a
// human decision. A read: it issues no cards and writes nothing. The wallet is
// taken from the session, never from the query.
export async function GET(req: NextRequest) {
  const address = getAuthedAddress(req, Date.now());
  const judge = address && WALLET_RE.test(address) ? address : null;
  const [tasks, houseWaiting] = await Promise.all([listTasks(), houseReviewWaiting()]);
  const flaggedWaiting = tasks.filter((t) => isAppealable(t)).length + houseWaiting;
  const record = judge ? await getJudgeStats(judge) : null;
  return NextResponse.json(
    { authenticated: !!judge, record, qualified: record ? isQualifiedJudge(record) : false, flaggedWaiting },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
