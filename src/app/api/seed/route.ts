import { NextRequest, NextResponse } from "next/server";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

export async function POST(req: NextRequest) {
  // Auth check even though endpoint is disabled — defense in depth
  if (!ADMIN_SECRET) {
    return NextResponse.json({ error: "Admin endpoint not configured" }, { status: 503 });
  }

  const { secret } = await req.json().catch(() => ({ secret: "" }));
  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    { error: "Seed endpoint disabled. All tasks must be funded on-chain." },
    { status: 403 }
  );
}
