import { NextResponse } from "next/server";
import { listProjects } from "@/lib/projects";

// GET /api/projects -> the picker: apps waiting for YES and live campaigns, one
// shape (lib/projects.ts). Public: counts and pictures, never a wallet.
export async function GET() {
  try {
    return NextResponse.json({ projects: await listProjects() }, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } });
  } catch {
    return NextResponse.json({ error: "The list could not be read. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
