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

  if (body.action === "reset-verification" && Array.isArray(body.ids)) {
    const tasks = await listTasks();
    let reset = 0;
    for (const id of body.ids) {
      const task = tasks.find(t => t.id === id);
      if (task) {
        (task as any).verificationResult = null;
        (task as any).status = task.claimant ? "claimed" : "open";
        await redis.set(`task:${id}`, JSON.stringify(task));
        reset++;
      }
    }
    return NextResponse.json({ reset });
  }

  if (body.action === "delete-tasks" && Array.isArray(body.ids)) {
    for (const id of body.ids) {
      await redis.del(`task:${id}`);
      await redis.srem("task_ids", id);
    }
    return NextResponse.json({ removed: body.ids.length });
  }

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

  if (body.action === "update-task" && body.id && body.fields) {
    const tasks = await listTasks();
    const task = tasks.find(t => t.id === body.id);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    for (const [k, v] of Object.entries(body.fields)) {
      (task as any)[k] = v;
    }
    await redis.set(`task:${body.id}`, JSON.stringify(task));
    return NextResponse.json({ updated: body.id });
  }

  if (body.action === "auto-archive") {
    const tasks = await listTasks();
    const now = Date.now();
    const FOURTEEN_DAYS = 14 * 24 * 3600_000;
    const archived: string[] = [];

    for (const t of tasks) {
      const age = now - new Date(t.createdAt).getTime();
      if (t.status === "open" && !t.claimant && age > FOURTEEN_DAYS) {
        (t as any).status = "expired";
        (t as any).archivedAt = new Date().toISOString();
        await redis.set(`task:${t.id}`, JSON.stringify(t));
        archived.push(t.id);
      }
    }
    return NextResponse.json({ archived: archived.length, ids: archived });
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
  // Points and USDC are never conflated (see reward.ts). bountyUsdc on a
  // points task is a points value, not dollars, so money sums only ever
  // include escrow-funded tasks — and "paid" only means a recorded
  // settlement tx, never just status === completed.
  const isFunded = (t: (typeof tasks)[number]) => t.onChainId !== null || !!t.escrowTxHash;
  let usdcDeposited = 0;
  let usdcSettled = 0;
  let usdcCompletedUnrecorded = 0; // funded + completed, but no settlement tx on record (pre-Jul-3 legacy payouts)
  let usdcPendingRelease = 0;
  let usdcOpenCommitted = 0;
  let pointsAwarded = 0;
  const fundedTasks = tasks.filter(isFunded);

  for (const t of tasks) {
    statuses[t.status] = (statuses[t.status] || 0) + 1;
    posters.add(t.poster);
    if (t.claimant) claimants.add(t.claimant);
    categories[t.category] = (categories[t.category] || 0) + 1;
    if (isFunded(t)) {
      usdcDeposited += t.bountyUsdc;
      if (t.settlementTx) usdcSettled += t.bountyUsdc;
      else if (t.pendingRelease) usdcPendingRelease += t.bountyUsdc;
      else if (t.status === "completed") usdcCompletedUnrecorded += t.bountyUsdc;
      else if (t.status === "open" || t.status === "claimed") usdcOpenCommitted += t.bountyUsdc;
    } else if (t.rewardType === "points") {
      pointsAwarded += t.bountyUsdc * (t.completionCount || 0);
    }
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

  const claimantDetails = [...claimants].map(addr => {
    const mine = tasks.filter(t => t.claimant === addr);
    const completedMine = mine.filter(t => t.status === "completed");
    return {
      address: addr,
      tasksClaimed: mine.length,
      tasksCompleted: completedMine.length,
      usdcEarned: completedMine.filter(t => isFunded(t) && t.settlementTx).reduce((s, t) => s + t.bountyUsdc, 0),
      usdcUnrecorded: completedMine.filter(t => isFunded(t) && !t.settlementTx).reduce((s, t) => s + t.bountyUsdc, 0),
      pointsEarned: completedMine.filter(t => !isFunded(t) && t.rewardType === "points").reduce((s, t) => s + t.bountyUsdc, 0),
    };
  });

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
      usdc: {
        deposited: usdcDeposited,
        settledPaid: usdcSettled,
        completedUnrecorded: usdcCompletedUnrecorded,
        pendingRelease: usdcPendingRelease,
        openCommitted: usdcOpenCommitted,
      },
      pointsAwarded,
    },
    events: {
      allTime: eventCounts || {},
      today: todayEvents || {},
      recent: recentEvents.slice(0, 20),
    },
  });
}
