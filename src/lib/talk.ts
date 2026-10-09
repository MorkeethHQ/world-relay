// TALK: one room per app, where people and agents talk. DESIGN-SYSTEM.md, Flow 4
// (Oscar, 9 Oct 2026: "a forum for humans and agents to discuss things", "ask
// favours etc in a more chill way", "Favour should go for rooms thats best").
//
// Phase one. No points, no money, no survey. An ask is a message with a flag
// and one button, "I can"; it pays nothing. A paid favour stays in the Favours tab.
//
// Pure where it can be: every function takes the store as its last argument, so
// a test runs it on the in-memory double. The default store is Redis, beside the
// polls keys:
//   talk:room:<id>:messages   a list, newest first, capped at ROOM_CAP
//   talk:room:<id>:hidden     a set of message ids a reviewer hid
//   talk:room:<id>:take:<mid> the one taker of an ask (SET NX, so one and only one)
//   talk:room:<id>:reported:<mid> who reported it (a set, one report per person)
//   talk:reports              a list of reports for review, newest first
//   talk:rate:person:<wallet> posts this minute; talk:rate:agent:<id>:<day> posts today
//
// Identity. A stored message carries `by`: the wallet or the agent id that wrote
// it. `by` is for the caps, the taker rule and review. It is NEVER served:
// `publicMessage()` is the only shape a route may answer with, and it holds the
// display name only (a World username, or the short handle the profile shows).
// A route gets the wallet from the session cookie, never from the body.
//
// Reads fail closed. A room whose list cannot be read answers { ok: false },
// never an empty room, so a store outage is not shown as silence.

import { clamp, hostIfLink, textOrNull } from "@/lib/content-rules";
import { publicPicture } from "@/lib/post-app";
import { projectKind } from "@/lib/project-view";
import { getRedis } from "@/lib/redis";

export const TEXT_MAX = 300; // one cap for every message
export const ROOM_CAP = 200; // messages kept per room
export const PERSON_PER_MINUTE = 6; // one wallet, posts per minute
export const AGENT_PER_DAY = 20; // one agent, posts per UTC day, stricter on purpose
export const REPORTS_CAP = 500;
export const NAME_MAX = 40;

// ---- the shapes ----

export type AuthorKind = "person" | "agent";

/** Who is writing, as the route proved it. `ref` is the wallet (lowercased) or the agent id. */
export type Author = { kind: AuthorKind; ref: string; name: string; picture?: string | null };

export type StoredMessage = {
  id: string;
  room: string;
  kind: AuthorKind;
  name: string;
  picture: string | null;
  text: string;
  ask: boolean;
  at: string;
  by: string; // never served
};

/** What a route answers with. No wallet, no agent id. */
export type Message = {
  id: string;
  room: string;
  author: { kind: AuthorKind; name: string; picture: string | null };
  text: string;
  ask: boolean;
  at: string;
  taken: { name: string } | null; // only on an ask: who said "I can"
};

export type RoomRead = { ok: true; messages: Message[]; pinned: Message | null; count: number } | { ok: false; reason: "unavailable" };

export type RoomSummary = { last: { name: string; text: string } | null; count: number | null }; // null: the store did not say

export type PostResult = { ok: true; message: Message } | { ok: false; reason: "empty" | "too_long" | "rate_limited" | "unavailable" | "bad_room" };
export type TakeResult = { ok: true; taken: { name: string }; first: boolean } | { ok: false; reason: "not_found" | "not_an_ask" | "taken" | "unavailable" | "agent" };
export type ReportResult = { ok: true; first: boolean } | { ok: false; reason: "not_found" | "unavailable" };

// ---- the store ----

export type TalkRedis = {
  lpush: (key: string, ...values: string[]) => Promise<unknown>;
  ltrim: (key: string, start: number, stop: number) => Promise<unknown>;
  lrange: (key: string, start: number, stop: number) => Promise<unknown[]>;
  sadd: (key: string, ...members: string[]) => Promise<unknown>;
  srem: (key: string, ...members: string[]) => Promise<unknown>;
  smembers: (key: string) => Promise<unknown[]>;
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: string, opts?: { nx?: boolean }) => Promise<unknown>;
  incr: (key: string) => Promise<number>;
  pexpire: (key: string, ms: number) => Promise<unknown>;
};

export function defaultTalkStore(): TalkRedis | null {
  const redis = getRedis();
  return redis ? (redis as unknown as TalkRedis) : null;
}

export const messagesKey = (room: string) => `talk:room:${room}:messages`;
export const hiddenKey = (room: string) => `talk:room:${room}:hidden`;
export const takeKey = (room: string, id: string) => `talk:room:${room}:take:${id}`;
export const reportedKey = (room: string, id: string) => `talk:room:${room}:reported:${id}`;
export const REPORTS_KEY = "talk:reports";

// ---- text ----

/** The one text rule. Empty is null. Over the cap is refused, not cut, so a
 *  person sees what happened. What is stored still passes clamp, so the cap holds. */
export function cleanText(v: unknown): { ok: true; text: string } | { ok: false; reason: "empty" | "too_long" } {
  const t = textOrNull(v);
  if (!t) return { ok: false, reason: "empty" };
  if (Array.from(t).length > TEXT_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, text: clamp(hostIfLink(t), TEXT_MAX) };
}

/** A display name: one line, short. Never a wallet: a caller that has only a wallet passes shortHandle(). */
export function cleanName(v: unknown): string | null {
  const t = textOrNull(v);
  return t ? clamp(t, NAME_MAX) : null;
}

/** The short handle the profile shows for a wallet with no username (useWorldUser.ts, truncateAddress). */
export function shortHandle(wallet: string): string {
  return wallet.startsWith("0x") && wallet.length > 10 ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : wallet.slice(0, 12);
}

// ---- the World username, resolved on the server ----

export type WorldName = { name: string; picture: string | null; username: boolean };

/** World's rule: a username, never an address. Asked from World's own list; when
 *  it does not answer, or the wallet has no username, the profile's short handle. */
export async function worldName(wallet: string, fetchFn: typeof fetch = fetch): Promise<WorldName> {
  const fallback: WorldName = { name: shortHandle(wallet), picture: null, username: false };
  try {
    const res = await fetchFn("https://usernames.worldcoin.org/api/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: [wallet] }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return fallback;
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return fallback;
    const row = rows.find((r) => r && typeof r === "object" && typeof (r as { address?: unknown }).address === "string" && (r as { address: string }).address.toLowerCase() === wallet.toLowerCase()) as { username?: unknown; profile_picture_url?: unknown } | undefined;
    const username = cleanName(row?.username);
    if (!username) return fallback;
    return { name: `@${username}`, picture: publicPicture(row?.profile_picture_url), username: true };
  } catch {
    return fallback;
  }
}

// ---- rooms ----

export function isRoomId(id: unknown): id is string {
  return projectKind(id) !== null;
}

function parse(raw: unknown): StoredMessage | null {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  if (typeof m.id !== "string" || typeof m.room !== "string" || typeof m.text !== "string" || typeof m.name !== "string" || typeof m.by !== "string") return null;
  if (m.kind !== "person" && m.kind !== "agent") return null;
  return {
    id: m.id, room: m.room, kind: m.kind, name: m.name, picture: typeof m.picture === "string" ? m.picture : null,
    text: m.text, ask: m.ask === true, at: typeof m.at === "string" ? m.at : "", by: m.by,
  };
}

function parseTaker(raw: unknown): { ref: string; name: string } | null {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  return typeof t.ref === "string" && typeof t.name === "string" ? { ref: t.ref, name: t.name } : null;
}

/** The only shape a route serves. The wallet or agent id is dropped here. */
export function publicMessage(m: StoredMessage, taken: { name: string } | null = null): Message {
  return { id: m.id, room: m.room, author: { kind: m.kind, name: m.name, picture: m.picture }, text: m.text, ask: m.ask, at: m.at, taken: m.ask ? taken : null };
}

async function stored(room: string, s: TalkRedis): Promise<StoredMessage[]> {
  const [raw, hidden] = await Promise.all([s.lrange(messagesKey(room), 0, -1), s.smembers(hiddenKey(room))]);
  const gone = new Set(hidden.map(String));
  return raw.map(parse).filter((m): m is StoredMessage => !!m && m.room === room && !gone.has(m.id));
}

async function takerOf(room: string, id: string, s: TalkRedis): Promise<{ ref: string; name: string } | null> {
  return parseTaker(await s.get(takeKey(room, id)));
}

/** A room, newest first, hidden messages absent. Fails closed: a store that
 *  cannot answer gives { ok: false }, never an empty room. */
export async function readRoom(room: unknown, s: TalkRedis | null = defaultTalkStore()): Promise<RoomRead> {
  if (!isRoomId(room) || !s) return { ok: false, reason: "unavailable" };
  try {
    const list = await stored(room, s);
    const takers = await Promise.all(list.map((m) => (m.ask ? takerOf(room, m.id, s) : Promise.resolve(null))));
    const messages = list.map((m, i) => publicMessage(m, takers[i] ? { name: takers[i]!.name } : null));
    const pinned = messages.find((m) => m.ask) ?? null;
    return { ok: true, messages, pinned, count: messages.length };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** For the room list: the last line and the count, each null when the store did not say. */
export async function roomSummaries(rooms: readonly string[], s: TalkRedis | null = defaultTalkStore()): Promise<Record<string, RoomSummary>> {
  const out: Record<string, RoomSummary> = {};
  await Promise.all(rooms.map(async (room) => {
    if (!s || !isRoomId(room)) { out[room] = { last: null, count: null }; return; }
    try {
      const list = await stored(room, s);
      out[room] = { last: list[0] ? { name: list[0].name, text: list[0].text } : null, count: list.length };
    } catch {
      out[room] = { last: null, count: null };
    }
  }));
  return out;
}

// ---- caps ----

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Two caps: a wallet per minute, an agent per UTC day. A store that cannot count refuses, so an outage opens nothing. */
export async function underCap(author: Author, now: number, s: TalkRedis): Promise<boolean> {
  if (author.kind === "person") {
    const key = `talk:rate:person:${author.ref}`;
    const n = await s.incr(key);
    if (n === 1) await s.pexpire(key, 60_000);
    return n <= PERSON_PER_MINUTE;
  }
  const key = `talk:rate:agent:${author.ref}:${dayOf(now)}`;
  const n = await s.incr(key);
  if (n === 1) await s.pexpire(key, 48 * 3600_000);
  return n <= AGENT_PER_DAY;
}

function messageId(now: number): string {
  const r = new Uint8Array(6);
  crypto.getRandomValues(r);
  return `m_${now.toString(36)}_${Array.from(r).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---- writes ----

/** One message. The author is what the route proved, never what the body said. */
export async function postMessage(
  input: { room: unknown; author: Author; text: unknown; ask?: unknown },
  now: number = Date.now(),
  s: TalkRedis | null = defaultTalkStore(),
): Promise<PostResult> {
  if (!isRoomId(input.room)) return { ok: false, reason: "bad_room" };
  const clean = cleanText(input.text);
  if (!clean.ok) return { ok: false, reason: clean.reason };
  const name = cleanName(input.author.name);
  if (!name || !input.author.ref) return { ok: false, reason: "unavailable" };
  if (!s) return { ok: false, reason: "unavailable" };
  try {
    if (!(await underCap(input.author, now, s))) return { ok: false, reason: "rate_limited" };
    const m: StoredMessage = {
      id: messageId(now), room: input.room, kind: input.author.kind, name, picture: publicPicture(input.author.picture),
      text: clean.text, ask: input.ask === true, at: new Date(now).toISOString(), by: input.author.ref,
    };
    await s.lpush(messagesKey(input.room), JSON.stringify(m));
    await s.ltrim(messagesKey(input.room), 0, ROOM_CAP - 1);
    return { ok: true, message: publicMessage(m) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** "I can" on an ask. A person only, one taker, first wins (SET NX). */
export async function takeAsk(room: unknown, messageId: unknown, taker: Author, s: TalkRedis | null = defaultTalkStore()): Promise<TakeResult> {
  if (taker.kind !== "person") return { ok: false, reason: "agent" };
  if (!isRoomId(room) || typeof messageId !== "string" || !s) return { ok: false, reason: "unavailable" };
  const name = cleanName(taker.name);
  if (!name) return { ok: false, reason: "unavailable" };
  try {
    const m = (await stored(room, s)).find((x) => x.id === messageId);
    if (!m) return { ok: false, reason: "not_found" };
    if (!m.ask) return { ok: false, reason: "not_an_ask" };
    const set = await s.set(takeKey(room, m.id), JSON.stringify({ ref: taker.ref, name }), { nx: true });
    if (set) return { ok: true, taken: { name }, first: true };
    const who = await takerOf(room, m.id, s);
    if (who && who.ref === taker.ref) return { ok: true, taken: { name: who.name }, first: false };
    return { ok: false, reason: "taken" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** A report sends the message to review. One report per person per message. */
export async function reportMessage(room: unknown, messageId: unknown, reporter: Author, now: number = Date.now(), s: TalkRedis | null = defaultTalkStore()): Promise<ReportResult> {
  if (!isRoomId(room) || typeof messageId !== "string" || !s) return { ok: false, reason: "unavailable" };
  try {
    const m = (await stored(room, s)).find((x) => x.id === messageId);
    if (!m) return { ok: false, reason: "not_found" };
    const added = Number(await s.sadd(reportedKey(room, m.id), reporter.ref)) === 1;
    if (added) {
      await s.lpush(REPORTS_KEY, JSON.stringify({ room, messageId: m.id, by: reporter.ref, at: new Date(now).toISOString() }));
      await s.ltrim(REPORTS_KEY, 0, REPORTS_CAP - 1);
    }
    return { ok: true, first: added };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Review: a hidden message is absent from every read. Nothing is deleted. */
export async function hideMessage(room: unknown, messageId: unknown, hidden: boolean, s: TalkRedis | null = defaultTalkStore()): Promise<boolean> {
  if (!isRoomId(room) || typeof messageId !== "string" || !s) return false;
  try {
    if (hidden) await s.sadd(hiddenKey(room), messageId);
    else await s.srem(hiddenKey(room), messageId);
    return true;
  } catch {
    return false;
  }
}
