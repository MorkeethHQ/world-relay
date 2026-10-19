import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { listCampaignResults } from "@/lib/campaign-drafts";

// GET /api/projects/<id> -> one project and, when live, its reviewed work.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const project = await getProject(id);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const results = project.status === "published" ? await listCampaignResults(id).catch(() => []) : [];
    return NextResponse.json({ project, results }, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } });
  } catch {
    return NextResponse.json({ error: "The project could not be read. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
