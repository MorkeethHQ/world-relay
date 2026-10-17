// POSTED APPS (pivot "Product Hunt for World"; Oscar's night ruling, 17 Oct 2026:
// the product slice, the 10 YES gate in v1, any signed-in outside wallet counts).
//
// A maker posts an app (api/post-app). It is saved as an ordinary campaign DRAFT
// and put in the pending set; it is NOT published. Signed-in wallets say YES to it
// (api/apps/vote). The votes are a set per posted app, so a count is a count of
// wallets and a repeat changes nothing. When lib/yes-gate.ts says 10 distinct
// outside wallets said YES, the draft is published through the existing
// publishDraft, as its maker. The published marker is SET NX, so two YES landing
// together publish once. A publish that fails (publishDraft allows one publish a
// day per maker) clears the marker and puts the app in the due set; the hourly
// pass (api/cron/publish-due) publishes it at the next allowed moment, with no
// further YES needed. A later YES also retries.
//
// A YES pays nothing and moves no money. publishDraft cannot fund anything.

import { getRedis } from "@/lib/redis";
import { DRAFT_PREFIX, type CampaignDraft } from "@/lib/campaign-drafts";
import { excludedFromEnv } from "@/lib/north-star";
import { YES_GATE, gateState } from "@/lib/yes-gate";

export const APPS_PENDING = "apps:pending";
export const APPS_DUE = "apps:due";
export const YES_PREFIX = "app:yes:";
export const PUBLISHED_MARK_PREFIX = "app:published:";
const WALLET = /^0x[0-9a-fA-F]{40}$/;

export type AppStore = {
  sadd: (key: string, member: string) => Promise<number>;
  srem: (key: string, member: string) => Promise<number>;
  sismember: (key: string, member: string) => Promise<number>;
  smembers: (key: string) => Promise<string[]>;
  get: (key: string) => Promise<string | null>;
  setNx: (key: string, value: string) => Promise<boolean>;
  del: (key: string) => Promise<void>;
};

export function redisAppStore(): AppStore | null {
  const redis = getRedis();
  if (!redis) return null;
  return {
    sadd: async (k, m) => Number(await redis.sadd(k, m)),
    srem: async (k, m) => Number(await redis.srem(k, m)),
    sismember: async (k, m) => Number(await redis.sismember(k, m)),
    smembers: async (k) => ((await redis.smembers(k)) as string[]) ?? [],
    get: async (k) => {
      const v = await redis.get(k);
      return v == null ? null : typeof v === "string" ? v : JSON.stringify(v);
    },
    setNx: async (k, v) => (await redis.set(k, v, { nx: true })) === "OK",
    del: async (k) => void (await redis.del(k)),
  };
}

async function draftOf(id: string, s: AppStore): Promise<CampaignDraft | null> {
  const raw = await s.get(`${DRAFT_PREFIX}${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as CampaignDraft; } catch { return null; }
}

/** Put a saved draft in the pending set. The post route calls this instead of publishing. */
export async function markPending(id: string, s: AppStore | null = redisAppStore()): Promise<boolean> {
  if (!s) return false;
  await s.sadd(APPS_PENDING, id);
  return true;
}

export type PendingApp = {
  id: string; productName: string; productUrl: string; ask: string; maker: string;
  yes: number; of: number; status: "pending" | "published";
};

/** The apps waiting for YES, oldest first, each with its outside count. */
export async function listPendingApps(
  { store = redisAppStore(), exclude = excludedFromEnv() }: { store?: AppStore | null; exclude?: Set<string> } = {},
): Promise<PendingApp[]> {
  if (!store) return [];
  const out: PendingApp[] = [];
  for (const id of await store.smembers(APPS_PENDING)) {
    const d = await draftOf(id, store);
    if (!d) continue; // one bad row must not hide the rest
    const g = gateState(await store.smembers(`${YES_PREFIX}${id}`), d.owner, exclude);
    out.push({ id, productName: d.productName ?? "", productUrl: d.productUrl ?? "", ask: d.brief, maker: d.owner, ...g });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export type PublishFn = (owner: string, id: string, now: number) => Promise<{ ok: boolean }>;

export type YesResult =
  | { ok: true; yes: number; of: number; status: "pending" | "published"; first: boolean }
  | { ok: false; reason: "unknown_app" | "not_pending" | "wallet_required" | "own_app" | "unavailable" };

/** One wallet says YES to one posted app. At the gate, the app is published once. */
export async function castYes(
  id: unknown,
  wallet: unknown,
  { store = redisAppStore(), publish, exclude = excludedFromEnv(), now = Date.now() }:
    { store?: AppStore | null; publish: PublishFn; exclude?: Set<string>; now?: number },
): Promise<YesResult> {
  if (typeof wallet !== "string" || !WALLET.test(wallet)) return { ok: false, reason: "wallet_required" };
  if (!store) return { ok: false, reason: "unavailable" };
  if (typeof id !== "string") return { ok: false, reason: "unknown_app" };
  try {
    if (!(await store.sismember(APPS_PENDING, id))) {
      return { ok: false, reason: (await store.get(`${PUBLISHED_MARK_PREFIX}${id}`)) ? "not_pending" : "unknown_app" };
    }
    const d = await draftOf(id, store);
    if (!d) return { ok: false, reason: "unknown_app" };
    const me = wallet.toLowerCase();
    if (me === d.owner.toLowerCase()) return { ok: false, reason: "own_app" };

    const first = (await store.sadd(`${YES_PREFIX}${id}`, me)) === 1;
    const g = gateState(await store.smembers(`${YES_PREFIX}${id}`), d.owner, exclude);
    if (g.status !== "published") return { ok: true, ...g, first };

    if ((await tryPublish(id, d.owner, store, publish, now)) === "failed") return { ok: true, ...g, status: "pending", first };
    return { ok: true, ...g, first };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Publish once behind the SET NX marker. A failure clears the marker and marks the app due. */
async function tryPublish(id: string, owner: string, store: AppStore, publish: PublishFn, now: number): Promise<"published" | "failed" | "taken"> {
  const mark = `${PUBLISHED_MARK_PREFIX}${id}`;
  if (!(await store.setNx(mark, new Date(now).toISOString()))) return "taken";
  const out = await publish(owner, id, now).catch(() => ({ ok: false }));
  if (!out.ok) {
    await store.del(mark);
    await store.sadd(APPS_DUE, id);
    return "failed";
  }
  await store.srem(APPS_PENDING, id);
  await store.srem(APPS_DUE, id);
  return "published";
}

/** The hourly pass: publish every due app whose gate still holds. Safe to run twice. */
export async function publishDue(
  { store = redisAppStore(), publish, exclude = excludedFromEnv(), now = Date.now() }:
    { store?: AppStore | null; publish: PublishFn; exclude?: Set<string>; now?: number },
): Promise<{ due: number; published: number }> {
  if (!store) return { due: 0, published: 0 };
  const ids = await store.smembers(APPS_DUE);
  let published = 0;
  for (const id of ids) {
    const d = (await store.sismember(APPS_PENDING, id)) ? await draftOf(id, store) : null;
    if (!d) { await store.srem(APPS_DUE, id); continue; } // published or gone
    if (gateState(await store.smembers(`${YES_PREFIX}${id}`), d.owner, exclude).status !== "published") continue;
    if ((await tryPublish(id, d.owner, store, publish, now)) === "published") published++;
  }
  return { due: ids.length, published };
}

export { YES_GATE };
