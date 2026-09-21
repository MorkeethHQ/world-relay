import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validatePrompt } from "@/lib/daily-generator";
import { CURATED_PROMPTS, promptForDate } from "@/lib/daily";
import { QUICK_IDEAS, isTemplateCopy, MIN_DESCRIPTION_LENGTH } from "@/lib/post-templates";

// 2026-09-21 quick points pass. Three rules pinned here:
// 1. A curated daily prompt obeys the same airlock as a generated one.
// 2. A curated prompt only ever fills an EMPTY slot, so a question that already
//    has answers is never relabelled under them.
// 3. A quick-post idea cannot be posted verbatim, so five ideas cannot become
//    the whole board.

describe("curated daily prompts", () => {
  it("every curated prompt passes the generator's airlock", () => {
    for (const [date, p] of Object.entries(CURATED_PROMPTS)) {
      expect(validatePrompt(p), date).not.toBeNull();
    }
  });

  it("is what everyone gets for its date, and the pool is untouched elsewhere", () => {
    for (const [date, p] of Object.entries(CURATED_PROMPTS)) {
      expect(promptForDate(date).question).toBe(p.question);
      expect(promptForDate(date).date).toBe(date);
    }
    expect(promptForDate("2026-09-21").question).not.toBe(CURATED_PROMPTS["2026-09-22"].question);
  });
});

describe("ensurePromptFor never relabels a stored prompt", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.resetModules();
    vi.doMock("@/lib/redis", () => ({
      getRedis: () => ({
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: string, opts?: { nx?: boolean }) => {
          if (opts?.nx && store.has(k)) return null;
          store.set(k, v);
          return "OK";
        },
      }),
    }));
  });

  afterEach(() => { vi.useRealTimers(); });

  it("keeps an already stored question once the curated date has started", async () => {
    const date = Object.keys(CURATED_PROMPTS)[0];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${date}T00:10:00Z`));
    const existing = { date, question: "Right now, are your eyes focused near or far?", type: "choice", options: ["Near", "Far"] };
    store.set(`daily:prompt:${date}`, JSON.stringify(existing));
    const { ensurePromptFor } = await import("@/lib/daily-generator");
    const r = await ensurePromptFor(date);
    expect(r.stored).toBe(false);
    expect(JSON.parse(store.get(`daily:prompt:${date}`)!).question).toBe(existing.question);
  });

  it("replaces a stored question while the curated date is still in the future", async () => {
    const date = Object.keys(CURATED_PROMPTS)[0];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(new Date(`${date}T00:00:00Z`).getTime() - 2 * 3600e3));
    store.set(`daily:prompt:${date}`, JSON.stringify({ date, question: "Right now, how loud is it around you?", type: "choice", options: ["Quiet", "Loud"] }));
    const { ensurePromptFor } = await import("@/lib/daily-generator");
    const r = await ensurePromptFor(date);
    expect(r.stored).toBe(true);
    expect(JSON.parse(store.get(`daily:prompt:${date}`)!).question).toBe(CURATED_PROMPTS[date].question);
  });

  it("fills an empty slot with the curated question, with no model call", async () => {
    const date = Object.keys(CURATED_PROMPTS)[0];
    const { ensurePromptFor } = await import("@/lib/daily-generator");
    const r = await ensurePromptFor(date);
    expect(r).toMatchObject({ stored: true, generated: false, reason: "curated" });
    expect(JSON.parse(store.get(`daily:prompt:${date}`)!).question).toBe(CURATED_PROMPTS[date].question);
  });
});

describe("quick post ideas", () => {
  it("are rejected verbatim, like template copy", () => {
    for (const i of QUICK_IDEAS) expect(isTemplateCopy(i.text)).toBe(true);
  });
  it("are long enough to be a valid ask once edited", () => {
    for (const i of QUICK_IDEAS) expect(i.text.length).toBeGreaterThanOrEqual(MIN_DESCRIPTION_LENGTH);
  });
  it("an edited idea is the poster's own words", () => {
    expect(isTemplateCopy("Which song would fix a grey Monday in Lisbon?")).toBe(false);
  });
});
