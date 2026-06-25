import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { listTasks } from "@/lib/store";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "No redis" }, { status: 500 });

  if (body.action === "cleanup-unfunded") {
    const tasks = await listTasks();
    const toRemove = tasks.filter(t =>
      t.status === "open" &&
      (t as any).agent &&
      !(t as any).escrowTxHash
    );
    for (const t of toRemove) {
      await redis.del(`task:${t.id}`);
      await redis.srem("task_ids", t.id);
    }
    return NextResponse.json({ removed: toRemove.length, ids: toRemove.map(t => t.id) });
  }

  if (body.action !== "dedup") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const tasks = await listTasks();
  const seen = new Map<string, string>();
  const toRemove: string[] = [];

  for (const t of tasks) {
    const key = t.description.slice(0, 80);
    if (seen.has(key)) {
      const existing = tasks.find(x => x.id === seen.get(key))!;
      const keepExisting = existing.onChainId != null || existing.status !== "open" || new Date(existing.createdAt) < new Date(t.createdAt);
      if (keepExisting) {
        toRemove.push(t.id);
      } else {
        toRemove.push(existing.id);
        seen.set(key, t.id);
      }
    } else {
      seen.set(key, t.id);
    }
  }

  for (const id of toRemove) {
    await redis.del(`task:${id}`);
    await redis.srem("task_ids", id);
  }

  return NextResponse.json({ removed: toRemove.length, ids: toRemove });
}

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
