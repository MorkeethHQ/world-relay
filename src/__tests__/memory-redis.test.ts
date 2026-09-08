import { describe, it, expect } from "vitest";
import { MemoryRedis, memoryStoreRequested } from "@/lib/memory-redis";

// The local store must be impossible to switch on by accident. It is a demo and
// test harness, and a machine holding production KV credentials must never fall
// into it, because a silent local store looks exactly like an empty product.

describe("memoryStoreRequested", () => {
  it("is off unless explicitly asked for", () => {
    expect(memoryStoreRequested({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("is off when real KV credentials are present, even if asked for", () => {
    expect(
      memoryStoreRequested({
        FAVOUR_MEMORY_STORE: "1",
        KV_REST_API_URL: "https://real.upstash.io",
        KV_REST_API_TOKEN: "token",
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it("is on only with the flag and no KV credentials", () => {
    expect(memoryStoreRequested({ FAVOUR_MEMORY_STORE: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("MemoryRedis", () => {
  it("round-trips the task-store shape: set, get, sadd, smembers", async () => {
    const r = new MemoryRedis();
    await r.set("task:a", JSON.stringify({ id: "a" }));
    await r.sadd("task_ids", "a");
    expect(await r.get("task:a")).toBe(JSON.stringify({ id: "a" }));
    expect(await r.smembers("task_ids")).toEqual(["a"]);
  });

  it("honours SET NX, which the escrow bind guard depends on", async () => {
    const r = new MemoryRedis();
    expect(await r.set("bind", "first", { nx: true })).toBe("OK");
    expect(await r.set("bind", "second", { nx: true })).toBeNull();
    expect(await r.get("bind")).toBe("first");
  });

  it("reads back a get-pipeline in order", async () => {
    const r = new MemoryRedis();
    await r.set("k1", "one");
    await r.set("k2", "two");
    const out = await r.pipeline().get("k1").get("k2").exec();
    expect(out).toEqual(["one", "two"]);
  });

  it("throws rather than faking an unimplemented command", async () => {
    const r = new MemoryRedis();
    await expect(r.eval()).rejects.toThrow(/not implemented/);
  });
});
