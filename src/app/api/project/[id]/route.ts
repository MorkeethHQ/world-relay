import { NextRequest, NextResponse } from "next/server";
import { getPublishedCampaign, listCampaignResults } from "@/lib/campaign-drafts";
import { getPictureRecord } from "@/lib/campaign-pictures";
import { fetchLaunches } from "@/lib/launch-feed";
import { fetchProduct, type FetchResult } from "@/lib/product-fetch";
import { candidateOrNull, tallies, type Tally } from "@/lib/product-votes";
import { favourProject, launchProject, projectKind, voteProject, type ProjectView } from "@/lib/project-view";

// GET /api/project/<id> -> one app from the rail, for the project page /p/<id>:
// a product on FAVOUR with its feedback round, a vote candidate, or an outside
// launch. DESIGN-SYSTEM.md, Flow 3. Public: nothing here names the caller, so
// "mine" for a vote stays on /api/votes. An id of no kind, a draft, a hidden
// campaign, a candidate whose page gave no name and a launch that is not in
// today's list all answer 404.
//
// The outside pages are read through the fence in lib/product-fetch.ts and kept
// for ten minutes, so a visit does not make this server call out each time.

const KEEP_MS = 10 * 60_000;
const pages = new Map<string, { at: number; result: FetchResult }>();

async function page(url: string, now: number): Promise<FetchResult> {
  const kept = pages.get(url);
  if (kept && now - kept.at < KEEP_MS) return kept.result;
  const result = await fetchProduct(url).catch((): FetchResult => ({ ok: false, reason: "unreadable" }));
  pages.set(url, { at: result.ok ? now : now - KEEP_MS + 60_000, result });
  return result;
}

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

async function read(id: string, now: number): Promise<{ project: ProjectView; maxAge: number } | null> {
  const kind = projectKind(id);
  if (kind === "favour") {
    const campaign = await getPublishedCampaign(id);
    if (!campaign || campaign.hidden) return null;
    const [results, record] = await Promise.all([listCampaignResults(id).catch(() => []), getPictureRecord(id).catch(() => null)]);
    const project = favourProject(campaign, results, record);
    return project && { project, maxAge: 10 };
  }
  if (kind === "vote") {
    const candidate = candidateOrNull(id);
    if (!candidate) return null;
    const [result, tally] = await Promise.all([page(candidate.url, now), tallies(null).catch((): Record<string, Tally> => ({}))]);
    const project = voteProject(candidate, result, tally[candidate.id] ?? null);
    return project && { project, maxAge: 30 };
  }
  if (kind === "launch") {
    const launch = (await fetchLaunches(now)).find((l) => l.id === id);
    if (!launch) return null;
    return { project: launchProject(launch, await page(launch.url, now)), maxAge: 60 };
  }
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const found = await read(id, Date.now());
    if (!found) return notFound();
    return NextResponse.json({ project: found.project }, { headers: { "Cache-Control": `public, s-maxage=${found.maxAge}, stale-while-revalidate=${found.maxAge * 2}` } });
  } catch {
    return NextResponse.json({ error: "This app could not be read. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
