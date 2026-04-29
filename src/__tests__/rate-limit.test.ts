import { describe, it, expect } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  it("allows requests within the limit", async () => {
    const key = `test-allow-${Date.now()}`;
    const r1 = await rateLimit(key, 3, 60_000);
    expect(r1.ok).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await rateLimit(key, 3, 60_000);
    expect(r2.ok).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await rateLimit(key, 3, 60_000);
    expect(r3.ok).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("blocks requests over the limit", async () => {
    const key = `test-block-${Date.now()}`;
    await rateLimit(key, 2, 60_000);
    await rateLimit(key, 2, 60_000);

    const blocked = await rateLimit(key, 2, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets after window expires", async () => {
    const key = `test-reset-${Date.now()}`;
    await rateLimit(key, 1, 1);

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 10));

    const after = await rateLimit(key, 1, 1);
    expect(after.ok).toBe(true);
  });

  it("tracks different keys independently", async () => {
    const key1 = `test-key1-${Date.now()}`;
    const key2 = `test-key2-${Date.now()}`;

    await rateLimit(key1, 1, 60_000);
    const blocked = await rateLimit(key1, 1, 60_000);
    expect(blocked.ok).toBe(false);

    const ok = await rateLimit(key2, 1, 60_000);
    expect(ok.ok).toBe(true);
  });
});
