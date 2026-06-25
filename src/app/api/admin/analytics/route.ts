import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { listTasks } from "@/lib/store";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redis = getRedis();
  const tasks = await listTasks();

  const statuses: Record<string, number> = {};
  const posters = new Set<string>();
  const claimants = new Set<string>();
  const categories: Record<string, number> = {};
  let totalBounty = 0;
  let claimedBounty = 0;
  let completedBounty = 0;
  const fundedTasks = tasks.filter(t => t.escrowTxHash);

  for (const t of tasks) {
    statuses[t.status] = (statuses[t.status] || 0) + 1;
    posters.add(t.poster);
    if (t.claimant) claimants.add(t.claimant);
    categories[t.category] = (categories[t.category] || 0) + 1;
    totalBounty += t.bountyUsdc;
    if (t.status === "claimed" || t.status === "completed") claimedBounty += t.bountyUsdc;
    if (t.status === "completed") completedBounty += t.bountyUsdc;
  }

  let eventCounts: Record<string, string> = {};
  let todayEvents: Record<string, string> = {};
  let recentEvents: string[] = [];
  let totalVisitors = 0;
  let todayVisitors = 0;

  if (redis) {
    const today = new Date().toISOString().slice(0, 10);
    [eventCounts, todayEvents, totalVisitors, todayVisitors] = await Promise.all([
      redis.hgetall("events:counts") as Promise<Record<string, string>>,
      redis.hgetall(`events:daily:${today}`) as Promise<Record<string, string>>,
      redis.scard("visitors:all"),
      redis.scard(`visitors:${today}`),
    ]);
    const raw = await redis.lrange("events:log", 0, 49);
    recentEvents = raw.map((r: unknown) => typeof r === "string" ? r : JSON.stringify(r));
  }

  const claimantDetails = [...claimants].map(addr => ({
    address: addr,
    tasksClaimed: tasks.filter(t => t.claimant === addr).length,
    tasksCompleted: tasks.filter(t => t.claimant === addr && t.status === "completed").length,
    totalEarned: tasks.filter(t => t.claimant === addr && t.status === "completed").reduce((s, t) => s + t.bountyUsdc, 0),
  }));

  return NextResponse.json({
    snapshot: new Date().toISOString(),
    tasks: {
      total: tasks.length,
      statuses,
      categories,
      funded: fundedTasks.length,
    },
    users: {
      uniquePosters: posters.size,
      uniqueClaimants: claimants.size,
      totalVisitors,
      todayVisitors,
      claimants: claimantDetails,
    },
    money: {
      totalBountyPool: totalBounty,
      claimedActive: claimedBounty,
      paidOut: completedBounty,
      stillOpen: totalBounty - claimedBounty,
    },
    events: {
      allTime: eventCounts || {},
      today: todayEvents || {},
      recent: recentEvents.slice(0, 20),
    },
  });
}
