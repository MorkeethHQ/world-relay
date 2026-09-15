import type { Task } from "./types";

export type JuryBridgeClaimResult =
  | { ok: true; task: Task }
  | { ok: false; error: string };

type FetchLike = typeof fetch;

/**
 * POST claim for the jury return-bridge favour. Isolated for UI success/error
 * tests with a mocked fetch — no Redis required in the test process.
 */
export async function postJuryBridgeClaim(
  favourId: string,
  claimant: string,
  fetchImpl: FetchLike = fetch
): Promise<JuryBridgeClaimResult> {
  try {
    const res = await fetchImpl(`/api/tasks/${favourId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimant }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      task?: Task;
    };
    if (!res.ok) {
      return { ok: false, error: body.error || body.message || "Could not claim this favour" };
    }
    const task = (body.task || body) as Task;
    if (!task || typeof task !== "object" || !("id" in task)) {
      return { ok: false, error: "Could not claim this favour" };
    }
    return { ok: true, task };
  } catch {
    return { ok: false, error: "Could not claim this favour" };
  }
}
