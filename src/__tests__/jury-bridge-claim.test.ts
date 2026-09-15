import { describe, it, expect, vi } from "vitest";
import { postJuryBridgeClaim } from "@/lib/jury-bridge-claim";
import type { Task } from "@/lib/types";

const TASK = {
  id: "bridge-1",
  status: "claimed",
  description: "Share one honest opinion",
} as Task;

describe("postJuryBridgeClaim (UI claim → callback wiring)", () => {
  it("success returns task for onBridgeClaimed", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ task: TASK }), { status: 200 })
    ) as unknown as typeof fetch;
    const result = await postJuryBridgeClaim("bridge-1", "0xabc", fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.task.id).toBe("bridge-1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/tasks/bridge-1/claim",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("error surfaces claim refusal for UI", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Daily limit reached" }), { status: 403 })
    ) as unknown as typeof fetch;
    const result = await postJuryBridgeClaim("bridge-1", "0xabc", fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Daily limit reached");
  });

  it("network failure does not throw", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const result = await postJuryBridgeClaim("bridge-1", "0xabc", fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/could not claim/i);
  });
});
