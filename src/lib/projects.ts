// THE PROJECT PICKER, storage side (see lib/projects-view.ts for the shape and
// the pure helpers). Reads the pending apps and the published campaigns and
// returns one list. Server only. Nothing here moves money or changes custody.

import { getRedis } from "@/lib/redis";
import { DRAFT_PREFIX, PUBLISHED_INDEX, type CampaignDraft } from "@/lib/campaign-drafts";
import { getPictureRecord } from "@/lib/campaign-pictures";
import { pictureOf } from "@/lib/post-app";
import { listPendingApps } from "@/lib/posted-apps";
import { excludedFromEnv } from "@/lib/north-star";
import { hostOf, isFromOtherSource, sortProjects, type ProjectCard } from "@/lib/projects-view";

async function loadDraft(id: string): Promise<CampaignDraft | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(`${DRAFT_PREFIX}${id}`).catch(() => null);
  if (!raw) return null;
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as CampaignDraft;
  } catch {
    return null;
  }
}

async function publishedCards(exclude: Set<string>): Promise<ProjectCard[]> {
  const redis = getRedis();
  if (!redis) return [];
  const ids = (((await redis.smembers(PUBLISHED_INDEX).catch(() => [])) as string[]) || []);
  const out: ProjectCard[] = [];
  for (const id of ids) {
    const d = await loadDraft(id);
    if (!d || d.hiddenAt || (d.status !== "published" && d.status !== "publishing")) continue;
    const name = d.productName ?? d.company;
    const url = d.productUrl ?? "";
    const record = await getPictureRecord(id).catch(() => null);
    out.push({
      id,
      name,
      url,
      host: hostOf(url),
      ask: d.brief,
      image: pictureOf(record, name, url).url,
      yes: 10,
      of: 10,
      status: "published",
      fromOtherSource: isFromOtherSource(d.owner, exclude),
      pieces: d.pieces.map((p) => ({ kind: p.kind, count: p.count, taskId: d.pieceTaskIds?.[p.kind] ?? null })),
      points: d.rewardPerPiecePoints,
      publishedAt: d.publishedAt ?? null,
    });
  }
  return out;
}

/** Every project the picker shows: pending apps and live campaigns, sorted. */
export async function listProjects(exclude: Set<string> = excludedFromEnv()): Promise<ProjectCard[]> {
  const pending = await listPendingApps({ exclude });
  const waiting: ProjectCard[] = await Promise.all(
    pending.map(async (a) => {
      const record = await getPictureRecord(a.id).catch(() => null);
      return {
        id: a.id,
        name: a.productName,
        url: a.productUrl,
        host: hostOf(a.productUrl),
        ask: a.ask,
        image: pictureOf(record, a.productName, a.productUrl).url,
        yes: a.yes,
        of: a.of,
        status: a.status,
        fromOtherSource: isFromOtherSource(a.maker, exclude),
        pieces: [],
        points: 10,
        publishedAt: null,
      };
    }),
  );
  const live = await publishedCards(exclude);
  const seen = new Set(live.map((p) => p.id));
  return sortProjects([...live, ...waiting.filter((p) => !seen.has(p.id))]);
}

export async function getProject(id: string, exclude: Set<string> = excludedFromEnv()): Promise<ProjectCard | null> {
  if (typeof id !== "string" || !id) return null;
  return (await listProjects(exclude)).find((p) => p.id === id) ?? null;
}
