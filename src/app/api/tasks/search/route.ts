import { NextRequest, NextResponse } from "next/server";
import { listTasks } from "@/lib/store";
import type { Task, TaskCategory, TaskStatus } from "@/lib/types";

const VALID_CATEGORIES: TaskCategory[] = ["photo", "delivery", "check-in", "custom", "feedback"];
const VALID_STATUSES: TaskStatus[] = ["open", "claimed", "completed", "failed", "expired", "cancelled"];
const VALID_SORTS = ["newest", "bounty_desc", "bounty_asc", "deadline_asc"] as const;
type SortOption = (typeof VALID_SORTS)[number];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // Parse parameters
  const q = searchParams.get("q")?.trim() || null;
  const category = searchParams.get("category") as TaskCategory | null;
  const status = searchParams.get("status") as TaskStatus | null;
  const minBounty = searchParams.get("min_bounty") ? Number(searchParams.get("min_bounty")) : null;
  const maxBounty = searchParams.get("max_bounty") ? Number(searchParams.get("max_bounty")) : null;
  const location = searchParams.get("location")?.trim() || null;
  const agentId = searchParams.get("agent_id")?.trim() || null;
  const sort = (searchParams.get("sort") as SortOption) || "newest";
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 20, 1), 100);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

  // Validate params
  if (category && !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` }, { status: 400 });
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }
  if (!VALID_SORTS.includes(sort)) {
    return NextResponse.json({ error: `Invalid sort. Must be one of: ${VALID_SORTS.join(", ")}` }, { status: 400 });
  }
  if (minBounty !== null && (!Number.isFinite(minBounty) || minBounty < 0)) {
    return NextResponse.json({ error: "min_bounty must be a non-negative number" }, { status: 400 });
  }
  if (maxBounty !== null && (!Number.isFinite(maxBounty) || maxBounty < 0)) {
    return NextResponse.json({ error: "max_bounty must be a non-negative number" }, { status: 400 });
  }

  // Fetch all tasks
  let tasks = await listTasks();

  // Apply filters
  const effectiveStatus = status ?? "open";
  tasks = tasks.filter((t: Task) => t.status === effectiveStatus);

  if (q) {
    const lowerQ = q.toLowerCase();
    tasks = tasks.filter((t: Task) =>
      t.description.toLowerCase().includes(lowerQ) ||
      t.location.toLowerCase().includes(lowerQ)
    );
  }

  if (category) {
    tasks = tasks.filter((t: Task) => t.category === category);
  }

  if (minBounty !== null) {
    tasks = tasks.filter((t: Task) => t.bountyUsdc >= minBounty);
  }

  if (maxBounty !== null) {
    tasks = tasks.filter((t: Task) => t.bountyUsdc <= maxBounty);
  }

  if (location) {
    const lowerLoc = location.toLowerCase();
    tasks = tasks.filter((t: Task) => t.location.toLowerCase().includes(lowerLoc));
  }

  if (agentId) {
    tasks = tasks.filter((t: Task) => t.agent?.id === agentId);
  }

  // Sort
  switch (sort) {
    case "newest":
      tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      break;
    case "bounty_desc":
      tasks.sort((a, b) => b.bountyUsdc - a.bountyUsdc);
      break;
    case "bounty_asc":
      tasks.sort((a, b) => a.bountyUsdc - b.bountyUsdc);
      break;
    case "deadline_asc":
      tasks.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
      break;
  }

  // Pagination
  const total = tasks.length;
  const paginated = tasks.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  // Build filters_applied object (only include non-null params)
  const filtersApplied: Record<string, string | number> = {};
  if (q) filtersApplied.q = q;
  filtersApplied.status = effectiveStatus;
  if (category) filtersApplied.category = category;
  if (minBounty !== null) filtersApplied.min_bounty = minBounty;
  if (maxBounty !== null) filtersApplied.max_bounty = maxBounty;
  if (location) filtersApplied.location = location;
  if (agentId) filtersApplied.agent_id = agentId;
  if (sort !== "newest") filtersApplied.sort = sort;

  return NextResponse.json({
    tasks: paginated,
    pagination: { total, limit, offset, hasMore },
    filters_applied: filtersApplied,
  });
}
