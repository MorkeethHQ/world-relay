import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Seed endpoint disabled. All tasks must be funded on-chain." },
    { status: 403 }
  );
}
