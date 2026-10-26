// THE PROJECT PICKER, storage side (see lib/projects-view.ts for the shape and
// the pure helpers). Reads the pending apps and the published campaigns and
// returns one list. Server only. Nothing here moves money or changes custody.

import { getRedis } from "@/lib/redis";
import { DRAFT_PREFIX, PUBLISHED_INDEX, type CampaignDraft } from "@/lib/campaign-drafts";
import { getPictureRecord } from "@/lib/campaign-pictures";
import { pictureOf } from "@/lib/post-app";

import { excludedFromEnv } from "@/lib/north-star";
import { getTask } from "@/lib/store";
import { campaignIntakePaused } from "@/lib/contribution-responses";
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
    // These app-profile experiments were retired from FAVOUR. Keep the source
    // records for history, but never revive them through the public picker.
    if (/^(lunch club|vibe)$/i.test(name.trim())) continue;
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
      pieces: d.pieces.map((p) => ({ kind: p.kind, count: p.count, taskId: d.pieceTaskIds?.[p.kind] ?? null, open: false, left: 0 })),
      points: d.rewardPerPiecePoints,
      publishedAt: d.publishedAt ?? null,
    });
  }
  return out;
}

/** Every project the picker shows: pending apps and live campaigns, sorted. */
export async function listProjects(exclude: Set<string> = excludedFromEnv()): Promise<ProjectCard[]> {
  return sortProjects(await publishedCards(exclude));
}

/** One project with each favour's live state read from its task, like the old
 *  CompanyCampaignView did: open only when the task is open, a completion is still
 *  wanted and the project is not paused while the company answers earlier work. */
export async function getProject(id: string, exclude: Set<string> = excludedFromEnv()): Promise<ProjectCard | null> {
  if (typeof id !== "string" || !id) return null;
  const p = (await listProjects(exclude)).find((x) => x.id === id);
  if (!p || p.status !== "published") return p ?? null;
  const paused = await campaignIntakePaused(id).catch(() => true);
  const pieces = await Promise.all(p.pieces.map(async (piece) => {
    const task = piece.taskId ? await getTask(piece.taskId).catch(() => undefined) : undefined;
    const left = task ? Math.max(0, (task.maxCompletions || piece.count) - (task.completionCount || 0)) : 0;
    return { ...piece, left, open: !!task && task.status === "open" && left > 0 && !paused };
  }));
  return { ...p, pieces };
}
