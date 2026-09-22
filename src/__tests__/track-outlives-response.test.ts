import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// EVERY TRACKED WRITE OUTLIVES THE RESPONSE (2026-09-22). About 20 routes call
// trackEvent(...).catch(() => {}) and answer without awaiting. On 22 Sep one such
// write was lost on production (2 mission_started sent, 1 counted). lib/track hands
// each write to Next's after(), so the function stays alive until it settles.

const scheduled: Array<() => unknown> = [];
let inRequest = true;
vi.mock("next/server", () => ({
  after: (cb: () => unknown) => {
    if (!inRequest) throw new Error("`after` was called outside a request scope");
    scheduled.push(cb);
  },
}));

let releaseWrite: (() => void) | null = null;
const writes: string[] = [];
const held = (label: string) => new Promise<number>((res) => { const prev = releaseWrite; releaseWrite = () => { prev?.(); writes.push(label); res(1); }; });
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    lpush: () => held("lpush"), ltrim: () => held("ltrim"), hincrby: (k: string) => held(`hincrby:${k}`),
    expire: () => held("expire"), sadd: (k: string) => held(`sadd:${k}`),
  }),
}));

import { trackEvent, trackReach, trackVisitor } from "@/lib/track";

beforeEach(() => { scheduled.length = 0; writes.length = 0; releaseWrite = null; inRequest = true; });

describe("a fire-and-forget write is kept alive past the response", () => {
  it("trackEvent, called the way the routes call it, schedules its write with after()", async () => {
    trackEvent("sign_in", { n: 1 }).catch(() => {}); // not awaited, like the routes
    expect(scheduled).toHaveLength(1);
    let settled = false;
    const kept = Promise.resolve(scheduled[0]()).then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false); // the function is held open while the write is pending
    releaseWrite!();
    await kept;
    expect(settled).toBe(true);
    expect(writes).toContain("hincrby:events:counts");
  });
  it("trackReach and trackVisitor too", () => {
    trackReach("device-1").catch(() => {});
    trackVisitor("0xabc").catch(() => {});
    expect(scheduled).toHaveLength(2);
  });
  it("an awaiting caller still waits for the write", async () => {
    let done = false;
    const p = trackEvent("mission_tapped").then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(false);
    releaseWrite!();
    await p;
    expect(done).toBe(true);
  });
  it("outside a request (scripts, tests) it still writes, and does not throw", async () => {
    inRequest = false;
    const p = trackEvent("board_replenished");
    releaseWrite!();
    await expect(p).resolves.toBeUndefined();
    expect(scheduled).toHaveLength(0);
  });
});

describe("no tracked write can skip the keep-alive", () => {
  const src = readFileSync(join(__dirname, "../lib/track.ts"), "utf8");
  it("every exported tracker goes through outliveResponse", () => {
    const exported = [...src.matchAll(/export (async )?function (\w+)\([\s\S]*?\n\}/g)];
    expect(exported.length).toBeGreaterThanOrEqual(3);
    for (const m of exported) {
      expect(m[1], `${m[2]} must not be an async writer itself`).toBeUndefined();
      expect(m[0], m[2]).toMatch(/return outliveResponse\(/);
    }
  });
});
