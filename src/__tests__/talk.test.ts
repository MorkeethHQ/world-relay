import { describe, expect, it } from "vitest";
import { createMemoryRedis } from "./helpers/memory-redis";
import {
  AGENT_PER_DAY, PERSON_PER_MINUTE, TEXT_MAX, cleanText, hideMessage, postMessage, readRoom, reportMessage,
  roomSummaries, shortHandle, takeAsk, worldName, type Author, type TalkRedis,
} from "@/lib/talk";

const W1 = "0x" + "a".repeat(40);
const W2 = "0x" + "b".repeat(40);
const maya: Author = { kind: "person", ref: W1, name: "@maya" };
const jonas: Author = { kind: "person", ref: W2, name: "@jonas" };
const scout: Author = { kind: "agent", ref: "scout-1a2b", name: "scout" };
const NOW = Date.parse("2026-10-09T12:00:00Z");

const memory = () => createMemoryRedis().client as unknown as TalkRedis;
const broken: TalkRedis = {
  lpush: async () => { throw new Error("down"); }, ltrim: async () => { throw new Error("down"); }, lrange: async () => { throw new Error("down"); },
  sadd: async () => { throw new Error("down"); }, srem: async () => { throw new Error("down"); }, smembers: async () => { throw new Error("down"); },
  get: async () => { throw new Error("down"); }, set: async () => { throw new Error("down"); }, incr: async () => { throw new Error("down"); }, pexpire: async () => { throw new Error("down"); },
};

describe("text", () => {
  it("drops empty text and the words undefined and null", () => {
    for (const v of ["", "   ", "undefined", "null", 3, null]) expect(cleanText(v)).toEqual({ ok: false, reason: "empty" });
  });
  it("refuses text over the one cap and keeps text at it", () => {
    expect(cleanText("x".repeat(TEXT_MAX + 1))).toEqual({ ok: false, reason: "too_long" });
    const r = cleanText("y".repeat(TEXT_MAX));
    expect(r.ok && Array.from(r.text).length).toBe(TEXT_MAX);
  });
  it("shows a bare link as its host and folds whitespace", () => {
    expect(cleanText("https://www.strive.app/signup?x=1")).toEqual({ ok: true, text: "strive.app" });
    expect(cleanText("  two   words \n here ")).toEqual({ ok: true, text: "two words here" });
  });
});

describe("a post", () => {
  it("is served without the wallet or the agent id, newest first", async () => {
    const s = memory();
    const a = await postMessage({ room: "strive", author: maya, text: "Can someone try sign-up on Android?", ask: true }, NOW, s);
    const b = await postMessage({ room: "strive", author: scout, text: "Two earlier reviews say the same." }, NOW + 1000, s);
    expect(a.ok && b.ok).toBe(true);
    const room = await readRoom("strive", s);
    expect(room.ok).toBe(true);
    if (!room.ok) return;
    expect(room.messages.map((m) => m.author.name)).toEqual(["scout", "@maya"]);
    expect(room.messages[0].author.kind).toBe("agent");
    expect(JSON.stringify(room)).not.toContain(W1);
    expect(JSON.stringify(room)).not.toContain("scout-1a2b");
    expect(room.pinned?.text).toBe("Can someone try sign-up on Android?");
    expect(room.pinned?.taken).toBeNull();
    expect(room.count).toBe(2);
  });

  it("refuses a room id of no kind and a bad text", async () => {
    const s = memory();
    expect(await postMessage({ room: "../x", author: maya, text: "hi" }, NOW, s)).toEqual({ ok: false, reason: "bad_room" });
    expect(await postMessage({ room: "strive", author: maya, text: "" }, NOW, s)).toEqual({ ok: false, reason: "empty" });
    expect(await postMessage({ room: "strive", author: maya, text: "z".repeat(TEXT_MAX + 1) }, NOW, s)).toEqual({ ok: false, reason: "too_long" });
  });

  it("caps a wallet per minute and an agent per day, more strictly", async () => {
    const s = memory();
    for (let i = 0; i < PERSON_PER_MINUTE; i++) expect((await postMessage({ room: "strive", author: maya, text: `m${i}` }, NOW, s)).ok).toBe(true);
    expect(await postMessage({ room: "strive", author: maya, text: "one more" }, NOW, s)).toEqual({ ok: false, reason: "rate_limited" });
    expect((await postMessage({ room: "strive", author: jonas, text: "another wallet" }, NOW, s)).ok).toBe(true);
    for (let i = 0; i < AGENT_PER_DAY; i++) expect((await postMessage({ room: "wave-radio", author: scout, text: `a${i}` }, NOW + i, s)).ok).toBe(true);
    expect(await postMessage({ room: "wave-radio", author: scout, text: "too many" }, NOW, s)).toEqual({ ok: false, reason: "rate_limited" });
    expect((await postMessage({ room: "wave-radio", author: scout, text: "next day" }, NOW + 24 * 3600_000, s)).ok).toBe(true);
    expect(AGENT_PER_DAY).toBeLessThan(PERSON_PER_MINUTE * 60 * 24);
  });

  it("answers unavailable, not a saved message, when the store is down or missing", async () => {
    expect(await postMessage({ room: "strive", author: maya, text: "hi" }, NOW, broken)).toEqual({ ok: false, reason: "unavailable" });
    expect(await postMessage({ room: "strive", author: maya, text: "hi" }, NOW, null)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("a read", () => {
  it("fails closed: a store that cannot answer is an error, never an empty room", async () => {
    expect(await readRoom("strive", broken)).toEqual({ ok: false, reason: "unavailable" });
    expect(await readRoom("strive", null)).toEqual({ ok: false, reason: "unavailable" });
    const empty = await readRoom("strive", memory());
    expect(empty).toEqual({ ok: true, messages: [], pinned: null, count: 0 });
  });

  it("leaves a hidden message out of the read itself, and unhide brings it back", async () => {
    const s = memory();
    const a = await postMessage({ room: "strive", author: maya, text: "keep" }, NOW, s);
    const b = await postMessage({ room: "strive", author: jonas, text: "spam" }, NOW + 1, s);
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(await hideMessage("strive", b.message.id, true, s)).toBe(true);
    const room = await readRoom("strive", s);
    expect(room.ok && room.messages.map((m) => m.text)).toEqual(["keep"]);
    expect(JSON.stringify(room)).not.toContain("spam");
    expect(room.ok && room.count).toBe(1);
    expect((await roomSummaries(["strive"], s)).strive).toEqual({ last: { name: "@maya", text: "keep", at: new Date(NOW).toISOString() }, count: 1, people: 1, faces: [{ name: "@maya", picture: null }] });
    await hideMessage("strive", b.message.id, false, s);
    const back = await readRoom("strive", s);
    expect(back.ok && back.messages.map((m) => m.text)).toEqual(["spam", "keep"]);
  });

  it("summaries: null, never zero, for a room the store could not read", async () => {
    expect((await roomSummaries(["strive"], broken)).strive).toEqual({ last: null, count: null, people: null, faces: [] });
    expect((await roomSummaries(["strive"], null)).strive).toEqual({ last: null, count: null, people: null, faces: [] });
    expect((await roomSummaries(["strive"], memory())).strive).toEqual({ last: null, count: 0, people: 0, faces: [] });
  });

  it("faces are distinct people, newest first, at most three, and never an agent", async () => {
    const s = memory();
    const w = (i: number): Author => ({ kind: "person", ref: "0x" + String(i).padStart(40, "0"), name: `@p${i}`, picture: i === 1 ? "https://pfp.world.org/p1.png" : null });
    for (let i = 1; i <= 5; i++) await postMessage({ room: "strive", author: w(i), text: `m${i}` }, NOW + i, s);
    await postMessage({ room: "strive", author: w(1), text: "again" }, NOW + 9, s);
    await postMessage({ room: "strive", author: scout, text: "agent" }, NOW + 10, s);
    const r = (await roomSummaries(["strive"], s)).strive;
    expect(r.faces).toEqual([{ name: "@p1", picture: "https://pfp.world.org/p1.png" }, { name: "@p5", picture: null }, { name: "@p4", picture: null }]);
    expect(r.people).toBe(5);
    expect(r.count).toBe(7);
    expect(r.last?.name).toBe("scout");
  });
});

describe("I can", () => {
  it("one taker, first wins, a repeat by the same person is not an error", async () => {
    const s = memory();
    const ask = await postMessage({ room: "strive", author: maya, text: "Try my sign-up?", ask: true }, NOW, s);
    if (!ask.ok) throw new Error("setup");
    expect(await takeAsk("strive", ask.message.id, jonas, s)).toEqual({ ok: true, taken: { name: "@jonas" }, first: true });
    expect(await takeAsk("strive", ask.message.id, jonas, s)).toEqual({ ok: true, taken: { name: "@jonas" }, first: false });
    expect(await takeAsk("strive", ask.message.id, maya, s)).toEqual({ ok: false, reason: "taken" });
    const room = await readRoom("strive", s);
    expect(room.ok && room.pinned?.taken).toEqual({ name: "@jonas" });
    expect(JSON.stringify(room)).not.toContain(W2);
  });

  it("an agent can never say I can, and a plain message is not an ask", async () => {
    const s = memory();
    const ask = await postMessage({ room: "strive", author: maya, text: "Try it?", ask: true }, NOW, s);
    const plain = await postMessage({ room: "strive", author: maya, text: "Hello" }, NOW, s);
    if (!ask.ok || !plain.ok) throw new Error("setup");
    expect(await takeAsk("strive", ask.message.id, scout, s)).toEqual({ ok: false, reason: "agent" });
    expect(await takeAsk("strive", plain.message.id, jonas, s)).toEqual({ ok: false, reason: "not_an_ask" });
    expect(await takeAsk("strive", "m_nope", jonas, s)).toEqual({ ok: false, reason: "not_found" });
    expect(await takeAsk("strive", ask.message.id, jonas, broken)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("a hidden ask cannot be taken", async () => {
    const s = memory();
    const ask = await postMessage({ room: "strive", author: maya, text: "Try it?", ask: true }, NOW, s);
    if (!ask.ok) throw new Error("setup");
    await hideMessage("strive", ask.message.id, true, s);
    expect(await takeAsk("strive", ask.message.id, jonas, s)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("a report", () => {
  it("goes to the review list once per person, and names nothing to the reporter", async () => {
    const s = memory();
    const m = await postMessage({ room: "strive", author: maya, text: "x" }, NOW, s);
    if (!m.ok) throw new Error("setup");
    expect(await reportMessage("strive", m.message.id, jonas, NOW, s)).toEqual({ ok: true, first: true });
    expect(await reportMessage("strive", m.message.id, jonas, NOW, s)).toEqual({ ok: true, first: false });
    expect(await reportMessage("strive", "m_nope", jonas, NOW, s)).toEqual({ ok: false, reason: "not_found" });
    expect(await reportMessage("strive", m.message.id, jonas, NOW, broken)).toEqual({ ok: false, reason: "unavailable" });
    expect(await s.lrange("talk:reports", 0, -1)).toHaveLength(1);
  });
});

describe("names", () => {
  it("the short handle is the profile's: six, three dots, four", () => {
    expect(shortHandle(W1)).toBe("0xaaaa...aaaa");
  });
  it("a World username wins; no answer gives the short handle, never the address", async () => {
    const ok = async () => new Response(JSON.stringify([{ address: W1, username: "maya", profile_picture_url: "https://pfp.world.org/maya.png" }]));
    expect(await worldName(W1, ok as typeof fetch)).toEqual({ name: "@maya", picture: "https://pfp.world.org/maya.png", username: true });
    const none = async () => new Response(JSON.stringify([{ address: W1, username: null, profile_picture_url: null }]));
    expect(await worldName(W1, none as typeof fetch)).toEqual({ name: "0xaaaa...aaaa", picture: null, username: false });
    const down = async () => { throw new Error("offline"); };
    expect(await worldName(W1, down as unknown as typeof fetch)).toEqual({ name: "0xaaaa...aaaa", picture: null, username: false });
    const bad = async () => new Response("not json", { status: 500 });
    expect((await worldName(W1, bad as typeof fetch)).name).toBe("0xaaaa...aaaa");
  });
});
