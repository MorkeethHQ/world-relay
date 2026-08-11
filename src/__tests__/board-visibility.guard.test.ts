import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { Task } from "@/lib/types";
import { isPublicTask } from "@/lib/task-serializer";
import { isBoardVisible, orderBoardForApi } from "@/lib/board-rank";

/**
 * BOARD-RULES.md R8 — the public-surface filter.
 *
 * WHY THIS FILE EXISTS (live smoke, 2026-08-11)
 * `isPublicTask` is a DROP filter applied in GET /api/tasks and GET /api/history,
 * before board-rank ever sees the list. It lived outside BOARD-RULES.md, so it was
 * never reviewed as a board rule — and it silently swallowed the entire public
 * Agent API.
 *
 * `/api/agent/tasks` mints `poster = agent_${agentId}`. TEST_IDENTITY matched
 * `^agent_`. So: POST returned 201 with a task id, GET /api/tasks/{id} returned the
 * task, the agent's own GET /api/agent/tasks listed it (that route does not apply
 * this filter) — and no human ever saw it on the board. Every surface said fine
 * except the only one that mattered.
 *
 * It went unnoticed because the seeded tasks that fill the live board use a
 * DIFFERENT prefix — `agent:<id>` with a colon — which was never filtered. The
 * board looked healthy the whole time the advertised integration was dead.
 *
 * These are regression assertions written from the OUTSIDE (what a third-party
 * agent posting to the documented endpoint must see), not from the filter's own
 * shape. Each has a control that must stay red.
 */

const NOW = new Date("2026-08-11T21:00:00Z").getTime();
const HOUR = 3600_000;

let seq = 0;
function task(overrides: Partial<Task> = {}): Task {
  seq++;
  return {
    id: `t${seq}`,
    poster: `poster${seq}`,
    claimant: null,
    category: "photo",
    description: `unique task description number ${seq}`,
    location: "Anywhere",
    lat: null,
    lng: null,
    bountyUsdc: 5,
    deadline: new Date(NOW + 100 * HOUR).toISOString(),
    status: "open",
    proofImageUrl: null,
    proofImages: null,
    proofNote: null,
    verificationResult: null,
    attestationTxHash: null,
    agent: null,
    aiFollowUp: null,
    recurring: null,
    callbackUrl: null,
    onChainId: null,
    escrowTxHash: null,
    claimCode: null,
    taskType: "standard",
    rewardType: "points",
    donOnChainId: null,
    donStakeTxHash: null,
    requiresClaim: false,
    pendingRelease: false,
    maxCompletions: 1,
    completionCount: 0,
    createdAt: new Date(NOW - 1 * HOUR).toISOString(),
    ...overrides,
  } as Task;
}

describe("R8: a task posted through the public Agent API reaches the board", () => {
  // THE ASSERTION THAT WOULD HAVE CAUGHT IT. Live task a88ef34c-d673-4399-8d45-
  // f2e104283c03 (2026-08-11) was created 201 and absent from GET /api/tasks.
  it("an agent_ poster is public", () => {
    expect(isPublicTask(task({ poster: "agent_smoke-pmv-w-2efc" }))).toBe(true);
  });

  it("survives the whole read path, not just the filter", () => {
    const t = task({ poster: "agent_freshmap-a1b2" });
    const board = orderBoardForApi([t].filter(isPublicTask), NOW);
    expect(board.map((x) => x.id)).toContain(t.id);
    expect(isBoardVisible(t, null, NOW)).toBe(true);
  });

  it("the platform seeder prefix (colon) stays public too", () => {
    expect(isPublicTask(task({ poster: "agent:freshmap" }))).toBe(true);
  });

  it("an agent_ CLAIMANT does not hide someone else's task", () => {
    expect(isPublicTask(task({ poster: "0xabc", claimant: "agent_runner-1" }))).toBe(true);
  });
});

describe("R8 controls: development-era junk stays hidden", () => {
  // These must stay red. If removing agent_ from TEST_IDENTITY had loosened the
  // filter generally, one of these would flip and the fix would be wrong.
  it.each([
    ["dev_1a1390db", "dev identity"],
    ["demo_8a3f9e22", "demo identity"],
    ["e2e_runner", "e2e identity"],
    ["0xATTACKER00", "security-audit wallet"],
  ])("%s is NOT public (%s)", (poster) => {
    expect(isPublicTask(task({ poster }))).toBe(false);
  });

  it("a dev_ CLAIMANT still hides the task", () => {
    expect(isPublicTask(task({ poster: "0xabc", claimant: "dev_alice" }))).toBe(false);
  });

  it("the one legacy agent_ e2e task is not resurrected onto the open board", () => {
    // agent_relay-e2e-verify2, Jul 2 2026, status cancelled — the only historical
    // agent_ task in the live store besides the smoke. It is now allowed past the
    // public filter, so board-rank is what must keep it off the board. Verified
    // here rather than assumed: this is the cost of the fix, priced.
    const legacy = task({ poster: "agent_relay-e2e-verify2", status: "cancelled" });
    expect(isPublicTask(legacy)).toBe(true);
    expect(isBoardVisible(legacy, null, NOW)).toBe(false);
  });
});

describe("R8: the two agent prefixes stay distinct", () => {
  // The fix is only correct while /api/agent/tasks keeps minting `agent_`. If a
  // future change moves it to `agent:`, third-party API tasks silently become
  // OFFICIAL seeded tasks (seed-caps.ts isSeededTask matches the colon prefix)
  // and start consuming claimants' daily official-favour cap. Pin the mint so
  // that rename cannot happen without landing here first.
  const routeSrc = readFileSync(
    join(process.cwd(), "src/app/api/agent/tasks/route.ts"),
    "utf8",
  );

  it("the public Agent API mints an agent_ poster (underscore)", () => {
    expect(routeSrc).toMatch(/poster\s*=\s*agentId\s*\?\s*`agent_\$\{agentId\}`/);
  });

  it("the public Agent API does not MINT the seeder's colon prefix", () => {
    // Scoped to the poster assignment on purpose: the GET handler in this same
    // file legitimately MATCHES `agent:${agentId}` so an agent can list its own
    // tasks under either prefix. Reading is fine; minting is what must not move.
    const mint = routeSrc.match(/const poster =[\s\S]*?;/)?.[0] ?? "";
    expect(mint).toContain("agent_");
    expect(mint).not.toContain("agent:");
  });

  it("TEST_IDENTITY no longer names the agent namespace at all", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/task-serializer.ts"), "utf8");
    const decl = src.match(/const TEST_IDENTITY = .*/)?.[0] ?? "";
    expect(decl).not.toContain("agent");
  });
});
