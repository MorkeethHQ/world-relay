import { NextRequest, NextResponse } from "next/server";
import { listTasks } from "@/lib/store";
import { toApiTasks, isPublicTask } from "@/lib/task-serializer";

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 120;

// History was downloading the ENTIRE board (~85 tasks, ~44KB) and filtering to
// completed on the client with no cap (Oscar Jul 9: "history seems lagging").
// This does the filtering server-side, returns only completed favours, newest
// first, capped — and strips the per-model AI breakdown the list never renders
// (same trim as /api/tasks). Same Task shape the page already consumes.
export async function GET(req: NextRequest) {
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  const completed = (await listTasks())
    .filter(isPublicTask)
    .filter((t) => t.status === "completed")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  const list = toApiTasks(completed).map((t) =>
    t.verificationResult?.models
      ? { ...t, verificationResult: { ...t.verificationResult, models: undefined } }
      : t
  );

  return NextResponse.json(
    { tasks: list },
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } }
  );
}
