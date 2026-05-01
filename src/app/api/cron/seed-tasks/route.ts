import { NextRequest, NextResponse } from "next/server";
import { seedDemoTasks } from "@/lib/seed-agents";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await seedDemoTasks();

    return NextResponse.json({
      ...result,
      seededAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Seed] Failed to seed demo tasks:", err);
    return NextResponse.json(
      { error: "Seed failed", detail: String(err) },
      { status: 500 }
    );
  }
}
