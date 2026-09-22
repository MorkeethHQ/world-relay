import { getRedis } from "./redis";

// COMPANY CAMPAIGN DRAFTS (FAVOUR-COMPANY-JOURNEY-2026-09-21).
//
// The journey Oscar ruled on 2026-09-21: a company launches a favour campaign,
// proposes a pool (the example is 200 USDC), invites useful work (a UGC clip, a
// short article, an honest review), and people pick a piece, submit proof, get
// reviewed and come back to their reward.
//
// WHAT A DRAFT IS, AND WHAT IT CAN NEVER DO.
//
// A draft is a company's PROPOSAL. It is stored here, in its own namespace
// (`campaign:draft:*`), and nowhere else. Live campaigns are the hardcoded list in
// campaigns.ts, and the ONLY path that can pay campaign USDC, campaign-unlock.ts,
// resolves a campaign through getCampaign(), which reads that list and never this
// store. So a draft cannot be unlocked, cannot be paid from, and a task cannot be
// tagged to one (POST /api/tasks validates campaignId through getCampaign too).
//
// The proposed pool is a number a company typed. It is shown, labelled "proposed,
// not funded", and it pays points at most. USDC only ever comes from a funded pot
// under the existing rules (Orb-gated, hard-capped, relayer transfer), and turning
// a draft into one is a separate, human act that this module has no way to do: a
// draft carries no `unlock`, no `pot` and no funding state, and any such field in
// the input is dropped, not stored. campaign-drafts.test.ts goes red if that ever
// stops being true.

export const DRAFT_PREFIX = "campaign:draft:";
export const DRAFT_INDEX_PREFIX = "campaign:drafts:";
export const DRAFT_ID_PREFIX = "draft_";
export const DRAFTS_PER_OWNER_MAX = 10;

import { PIECE_KINDS, PIECE_LABEL, PIECE_ASK, MAX_PIECES_PER_KIND, MAX_PIECES_TOTAL, productUrlOrNull, publishGateReason, type PieceKind, type ReviewRule, type CampaignDraft, type PublicCompanyCampaign, type CampaignResult } from "./campaign-draft-shape";
export { PIECE_KINDS, PIECE_LABEL, MAX_PIECES_PER_KIND, MAX_PIECES_TOTAL, MIN_BRIEF_WORDS, briefWords, productUrlOrNull, publishGateReason, type PieceKind, type ReviewRule, type CampaignDraft, type PublicCompanyCampaign, type CampaignResult } from "./campaign-draft-shape";
import type { Task, TaskCategory } from "./types";
import { gibberishReason } from "./post-quality";

type Result = { ok: true; draft: Omit<CampaignDraft, "id" | "owner" | "createdAt"> } | { ok: false; error: string };

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

// Builds a draft from untrusted input by COPYING ONLY KNOWN FIELDS. Anything else
// in the body (unlock, pot, funded, escrow, status, owner) never reaches storage.
export function validateDraftInput(body: unknown): Result {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const company = text(b.company, 80);
  const brief = text(b.brief, 500);
  if (company.length < 2) return { ok: false, error: "Add the company name." };
  if (brief.length < 20) return { ok: false, error: "Say what you want made, in a sentence or two." };
  // The same quality gate POST /api/tasks applies to a favour's text. Publishing
  // creates tasks directly, so without this a keyboard-mash brief would become
  // three filler cards on the board, the exact supply Oscar ruled against on
  // 2026-09-16. Checked on the plan, so it is refused before anything is saved.
  const junk = gibberishReason(brief);
  if (junk) return { ok: false, error: junk };
  // The company door (T3): a real brief and a product link, checked at save so
  // the form says so at once, and again at publish for drafts saved before.
  const productUrl = productUrlOrNull(b.productUrl);
  const gate = publishGateReason({ brief, productUrl });
  if (gate) return { ok: false, error: gate };

  const rawPieces = Array.isArray(b.pieces) ? b.pieces : [];
  const pieces: CampaignDraft["pieces"] = [];
  for (const p of rawPieces) {
    const kind = (p as { kind?: unknown })?.kind;
    const count = Number((p as { count?: unknown })?.count);
    if (!PIECE_KINDS.includes(kind as PieceKind)) continue;
    if (!Number.isInteger(count) || count < 1) continue;
    if (pieces.some((x) => x.kind === kind)) continue;
    // REFUSED, not clamped. A silent clamp would publish a different campaign
    // from the one the company planned.
    if (count > MAX_PIECES_PER_KIND) {
      return { ok: false, error: `Up to ${MAX_PIECES_PER_KIND} pieces of each kind while the pool is only proposed.` };
    }
    pieces.push({ kind: kind as PieceKind, count });
  }
  if (pieces.length === 0) return { ok: false, error: "Choose at least one kind of work and how many pieces." };
  const totalPieces = pieces.reduce((n, p) => n + p.count, 0);
  if (totalPieces > MAX_PIECES_TOTAL) {
    return { ok: false, error: `Up to ${MAX_PIECES_TOTAL} pieces in total while the pool is only proposed. This plan has ${totalPieces}.` };
  }

  const reward = Number(b.rewardPerPiecePoints);
  if (!Number.isInteger(reward) || reward < 1 || reward > 10) {
    return { ok: false, error: "Reward per accepted piece is 1 to 10 points while the pool is only proposed." };
  }

  const pool = Number(b.proposedPoolUsdc);
  if (!Number.isFinite(pool) || pool < 0 || pool > 10_000) {
    return { ok: false, error: "The proposed pool must be between 0 and 10,000 USDC." };
  }

  const reviewRule: ReviewRule = b.reviewRule === "ai_and_jury" ? "ai_and_jury" : "ai";

  return {
    ok: true,
    draft: {
      status: "draft",
      company,
      brief,
      pieces,
      rewardPerPiecePoints: reward,
      proposedPoolUsdc: Math.round(pool * 100) / 100,
      reviewRule,
      productUrl: productUrl!,
    },
  };
}

// A draft never pays USDC. Stated as a function so the rule has one place to live
// and one test to fail.
export function draftCanPayUsdc(_draft: CampaignDraft): false {
  return false;
}

export function isDraftId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(DRAFT_ID_PREFIX);
}

export async function saveDraft(
  owner: string,
  input: Omit<CampaignDraft, "id" | "owner" | "createdAt">,
  now: number,
  newId: () => string,
): Promise<{ ok: true; draft: CampaignDraft } | { ok: false; error: string; status: number }> {
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Drafts cannot be saved right now.", status: 503 };
  const addr = owner.toLowerCase();
  const indexKey = `${DRAFT_INDEX_PREFIX}${addr}`;
  const count = Number((await redis.scard(indexKey)) || 0);
  if (count >= DRAFTS_PER_OWNER_MAX) {
    return { ok: false, error: `You already have ${DRAFTS_PER_OWNER_MAX} drafts.`, status: 409 };
  }
  const draft: CampaignDraft = { ...input, id: `${DRAFT_ID_PREFIX}${newId()}`, owner: addr, createdAt: new Date(now).toISOString() };
  await redis.set(`${DRAFT_PREFIX}${draft.id}`, JSON.stringify(draft));
  await redis.sadd(indexKey, draft.id);
  return { ok: true, draft };
}

export async function listDrafts(owner: string): Promise<CampaignDraft[]> {
  const redis = getRedis();
  if (!redis) return [];
  const ids = ((await redis.smembers(`${DRAFT_INDEX_PREFIX}${owner.toLowerCase()}`).catch(() => [])) as string[]) || [];
  const out: CampaignDraft[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${DRAFT_PREFIX}${id}`).catch(() => null);
    if (!raw) continue;
    try {
      const d = (typeof raw === "string" ? JSON.parse(raw) : raw) as CampaignDraft;
      if (d && d.owner === owner.toLowerCase()) out.push(d);
    } catch {
      // One bad row must not hide the rest.
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}


// ─── PUBLISHING A PLAN AS A POINTS-ONLY CAMPAIGN ──────────────────────────────
//
// Oscar, 2026-09-21: "The crucial next user path is company campaign -> visible
// pieces people can join -> proof -> review -> reward -> return, with real 200 USDC
// funding as a separate authorized step." So a company may publish its own plan,
// and that puts its pieces on the board as ordinary POINTS favours that anyone can
// join. Everything after that is the existing path: the proof flow, the AI check,
// the jury, the points credit, History.
//
// What publishing does NOT do: fund anything. There is no funded state. The pieces
// carry `companyCampaignId`, never `campaignId`, and campaign-unlock.ts, the only
// campaign path that can pay USDC, reads campaignId alone. The proposed pool stays
// a proposal; turning it into a funded pot is the separate step this module
// cannot take.
//
// One task per KIND of piece, with maxCompletions = pieces wanted, so a campaign
// adds at most three cards to the board. Combined with one pass per person per
// favour (lib/completions.ts), each person can deliver each kind once.

export const PUBLISHED_INDEX = "campaign:company:published";
export const PUBLISH_DAY_PREFIX = "campaign:company:publish-day:";
export const RESULTS_PREFIX = "campaign:company:results:";
export const RESULTS_MAX = 100;
export const PIECE_DEADLINE_HOURS = 7 * 24;

const KIND_CATEGORY: Record<PieceKind, TaskCategory> = {
  ugc: "social",
  article: "custom",
  review: "review",
};

// The ask per kind lives in campaign-draft-shape (PIECE_ASK) so the proof screen can
// show it on its own line.
const KIND_ASK = PIECE_ASK;

export function pieceDescription(company: string, brief: string, kind: PieceKind): string {
  return `${company} campaign · ${PIECE_LABEL[kind]}. ${brief} ${KIND_ASK[kind]}`;
}

type CreateTaskFn = (input: {
  poster: string;
  category: TaskCategory;
  description: string;
  location: string;
  bountyUsdc: number;
  deadlineHours: number;
  rewardType: "points";
  maxCompletions: number;
  companyCampaignId: string;
}) => Promise<Pick<Task, "id">>;

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

export const PUBLISH_LOCK_PREFIX = "campaign:company:publish-lock:";

// RESUMABLE and IDEMPOTENT (fix, 2026-09-21). The first version claimed the day's
// publish, then created pieces one by one, and only marked the draft published at
// the end. A failure on piece 2 of 3 therefore left piece 1 live on the board with
// a campaign id that resolved to nothing (no label, no kind, no company page), and
// the day's publish was spent, so the company could neither finish nor retry.
//
// Now:
//   - the day slot is keyed to THIS draft, so the same draft can resume the same
//     day, while a different draft still waits a day;
//   - the draft moves to "publishing" before the first piece, and its pieceTaskIds
//     are saved after EACH piece, so a retry creates only what is missing;
//   - a campaign in "publishing" resolves by id, so pieces already made keep their
//     campaign identity for History, review results and the company page;
//   - a per-draft lock stops two concurrent publishes duplicating a piece.
export async function publishDraft(
  owner: string,
  id: string,
  now: number,
  createTask: CreateTaskFn,
): Promise<{ ok: true; campaign: PublicCompanyCampaign } | { ok: false; error: string; status: number }> {
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Campaigns cannot be published right now.", status: 503 };
  const addr = owner.toLowerCase();
  const first = await loadDraft(id);
  // Not found and not yours answer the same, so a draft id reveals nothing.
  if (!first || first.owner !== addr) return { ok: false, error: "No such draft.", status: 404 };
  if (first.status === "published") return { ok: false, error: "This campaign is already published.", status: 409 };
  // A draft saved before the company door opened may lack the link or the words.
  // A campaign already part way through publishing is let finish: its pieces are
  // on the board and must keep their campaign identity.
  if (first.status === "draft") {
    const gate = publishGateReason(first);
    if (gate) return { ok: false, error: gate, status: 422 };
  }

  const lockKey = `${PUBLISH_LOCK_PREFIX}${id}`;
  const locked = await redis.set(lockKey, "1", { nx: true, px: 60_000 });
  if (!locked) return { ok: false, error: "Publishing is already in progress. Try again in a minute.", status: 409 };

  try {
    // Re-read under the lock: another request may have finished it meanwhile.
    const draft = (await loadDraft(id)) ?? first;
    if (draft.status === "published") return { ok: false, error: "This campaign is already published.", status: 409 };

    // One publish per company wallet per UTC day, keyed to the draft. A resume of
    // the SAME draft passes; a different draft is refused.
    const day = new Date(now).toISOString().slice(0, 10);
    const dayKey = `${PUBLISH_DAY_PREFIX}${addr}:${day}`;
    const claimed = await redis.set(dayKey, id, { nx: true, ex: 2 * 86400 });
    if (!claimed) {
      const holder = await redis.get(dayKey).catch(() => null);
      if (holder !== id) return { ok: false, error: "You can publish one campaign a day.", status: 429 };
    }

    const pieceTaskIds: Partial<Record<PieceKind, string>> = { ...(draft.pieceTaskIds ?? {}) };
    let current: CampaignDraft = { ...draft, status: "publishing", pieceTaskIds };
    await redis.set(`${DRAFT_PREFIX}${id}`, JSON.stringify(current));

    for (const p of draft.pieces) {
      if (pieceTaskIds[p.kind]) continue; // made on an earlier attempt
      let task: Pick<Task, "id">;
      try {
        task = await createTask({
          poster: addr,
          category: KIND_CATEGORY[p.kind],
          description: pieceDescription(draft.company, draft.brief, p.kind),
          location: "Online",
          bountyUsdc: draft.rewardPerPiecePoints,
          deadlineHours: PIECE_DEADLINE_HOURS,
          rewardType: "points",
          maxCompletions: p.count,
          companyCampaignId: draft.id,
        });
      } catch {
        return {
          ok: false,
          error: "Publishing stopped part way. Nothing is lost: tap Finish publishing to add the rest.",
          status: 502,
        };
      }
      pieceTaskIds[p.kind] = task.id;
      current = { ...current, pieceTaskIds: { ...pieceTaskIds } };
      await redis.set(`${DRAFT_PREFIX}${id}`, JSON.stringify(current));
    }

    const published: CampaignDraft & { status: "published" } = { ...current, status: "published", publishedAt: new Date(now).toISOString() };
    await redis.set(`${DRAFT_PREFIX}${id}`, JSON.stringify(published));
    await redis.sadd(PUBLISHED_INDEX, id);
    return { ok: true, campaign: toPublic(published) };
  } finally {
    await redis.del(lockKey).catch(() => {});
  }
}

function toPublic(d: CampaignDraft & { status: "publishing" | "published" }): PublicCompanyCampaign {
  return {
    id: d.id,
    company: d.company,
    brief: d.brief,
    pieces: d.pieces,
    rewardPerPiecePoints: d.rewardPerPiecePoints,
    proposedPoolUsdc: d.proposedPoolUsdc,
    reviewRule: d.reviewRule,
    publishedAt: d.publishedAt,
    pieceTaskIds: d.pieceTaskIds,
    productUrl: d.productUrl,
    status: d.status,
    companyChecked: typeof d.companyCheckedAt === "string" && d.companyCheckedAt.length > 0,
  };
}

// Resolves a campaign whose pieces exist on the board: fully published, or part way
// through publishing. The second matters: a piece made before an interrupted
// publish must still carry its campaign's name and kind. A plain draft, which has
// no pieces on the board, never resolves.
export async function getPublishedCampaign(id: string): Promise<PublicCompanyCampaign | null> {
  const d = await loadDraft(id);
  if (!d || (d.status !== "published" && d.status !== "publishing")) return null;
  return toPublic(d as CampaignDraft & { status: "publishing" | "published" });
}

export async function listPublishedCampaigns(limit = 10): Promise<PublicCompanyCampaign[]> {
  const redis = getRedis();
  if (!redis) return [];
  const ids = ((await redis.smembers(PUBLISHED_INDEX).catch(() => [])) as string[]) || [];
  const out: PublicCompanyCampaign[] = [];
  for (const id of ids) {
    const c = await getPublishedCampaign(id);
    if (c) out.push(c);
  }
  return out.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")).slice(0, limit);
}

// Which kind of piece a task is, from the campaign's own map.
export function kindOfTask(c: Pick<CampaignDraft, "pieceTaskIds">, taskId: string): PieceKind | null {
  for (const k of PIECE_KINDS) if (c.pieceTaskIds?.[k] === taskId) return k;
  return null;
}

// The company sees what was accepted and what was rejected, and why. Written by
// verify-proof for pieces of a published company campaign. The participant is
// shortened: the company needs to see the work was reviewed, not who they are.
export async function recordCampaignResult(companyCampaignId: string, r: CampaignResult): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.lpush(`${RESULTS_PREFIX}${companyCampaignId}`, JSON.stringify(r));
  await redis.ltrim(`${RESULTS_PREFIX}${companyCampaignId}`, 0, RESULTS_MAX - 1);
}

export async function listCampaignResults(companyCampaignId: string, limit = 30): Promise<CampaignResult[]> {
  const redis = getRedis();
  if (!redis) return [];
  const raw = await redis.lrange(`${RESULTS_PREFIX}${companyCampaignId}`, 0, limit - 1).catch(() => [] as unknown[]);
  const out: CampaignResult[] = [];
  for (const r of raw as unknown[]) {
    try {
      const x = typeof r === "string" ? JSON.parse(r) : r;
      if (x && typeof x.taskId === "string") out.push(x as CampaignResult);
    } catch {}
  }
  return out;
}

export function shortAddress(a: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : "someone";
}
