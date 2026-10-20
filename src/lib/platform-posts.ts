import { randomUUID } from "node:crypto";
import { getRedis } from "./redis";
import { publicIdOrSame } from "./public-id";

export type PlatformPostKind = "build" | "agent_problem";
export type PlatformPost = {
  id: string;
  kind: PlatformPostKind;
  title: string;
  body: string;
  projectUrl: string | null;
  author: string;
  createdAt: string;
  moderation: "published" | "hidden" | "removed";
};
export type PublicPlatformPost = Omit<PlatformPost, "author"> & { author: string; likes: number; likedByYou: boolean };

const INDEX = "platform:posts";
const POST = "platform:post:";
const LIKES = "platform:likes:";
const localPosts = new Map<string, PlatformPost>();
const localOrder: string[] = [];
const localLikes = new Map<string, Set<string>>();

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length === 0 || text.length > max) return null;
  if (/0x[0-9a-fA-F]{40,}/.test(text)) return null;
  if (/(?:private[_ -]?key|seed phrase|api[_ -]?key)\s*[:=]/i.test(text)) return null;
  return text;
}

function cleanUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 500) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function parsePlatformPost(input: Record<string, unknown>, author: string): PlatformPost | null {
  const kind = input.kind;
  const title = cleanText(input.title, 90);
  const body = cleanText(input.body, 800);
  const projectUrl = cleanUrl(input.projectUrl);
  const kindOkay = kind === "build" || kind === "agent_problem";
  if (kindOkay === false || title === null || body === null || projectUrl === undefined) return null;
  return { id: randomUUID(), kind, title, body, projectUrl, author: author.toLowerCase(), createdAt: new Date().toISOString(), moderation: "published" };
}

export async function createPlatformPost(post: PlatformPost): Promise<void> {
  const redis = getRedis();
  if (redis === null) { localPosts.set(post.id, post); localOrder.unshift(post.id); return; }
  const pipeline = redis.pipeline();
  pipeline.set(`${POST}${post.id}`, JSON.stringify(post));
  pipeline.lpush(INDEX, post.id);
  pipeline.ltrim(INDEX, 0, 199);
  await pipeline.exec();
}

async function rawPosts(): Promise<PlatformPost[]> {
  const redis = getRedis();
  if (redis === null) return localOrder.map((id) => localPosts.get(id)).filter((post): post is PlatformPost => Boolean(post));
  const ids = (await redis.lrange(INDEX, 0, 49).catch(() => [])) as string[];
  const rows = await Promise.all(ids.map((id) => redis.get<PlatformPost>(`${POST}${id}`).catch(() => null)));
  return rows.filter((post): post is PlatformPost => Boolean(post));
}

export async function listPlatformPosts(viewer: string | null): Promise<PublicPlatformPost[]> {
  const redis = getRedis();
  const posts = (await rawPosts()).filter((post) => post.moderation === "published");
  return Promise.all(posts.map(async (post) => {
    const localSet = localLikes.get(post.id) ?? new Set<string>();
    const likes = redis === null ? localSet.size : Number(await redis.scard(`${LIKES}${post.id}`).catch(() => 0));
    const likedByYou = viewer === null ? false : redis === null
      ? localSet.has(viewer.toLowerCase())
      : Boolean(await redis.sismember(`${LIKES}${post.id}`, viewer.toLowerCase()).catch(() => 0));
    return { ...post, author: String(publicIdOrSame(post.author)), likes, likedByYou };
  }));
}

export async function likePlatformPost(id: string, wallet: string): Promise<{ likes: number; added: boolean } | null> {
  const redis = getRedis();
  if (redis === null) {
    if (localPosts.has(id) === false) return null;
    const set = localLikes.get(id) ?? new Set<string>();
    const before = set.size;
    set.add(wallet.toLowerCase());
    localLikes.set(id, set);
    return { likes: set.size, added: set.size > before };
  }
  const exists = await redis.exists(`${POST}${id}`).catch(() => 0);
  if (exists === 0) return null;
  const added = Number(await redis.sadd(`${LIKES}${id}`, wallet.toLowerCase())) === 1;
  const likes = Number(await redis.scard(`${LIKES}${id}`));
  return { likes, added };
}

export function resetPlatformPostsForTest() {
  localPosts.clear();
  localOrder.splice(0);
  localLikes.clear();
}
