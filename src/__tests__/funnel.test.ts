import { describe, expect, it } from "vitest";
import { computeFunnel, FUNNEL_EVENTS, type FunnelReader } from "@/lib/funnel";

const NOW = Date.parse("2026-08-10T12:00:00.000Z");

describe("anonymous first-value funnel", () => {
  it("reports only aggregate unique-device transitions for a cohort", async () => {
    const sets: Record<string, string[]> = {
      "funnel:cohort:2026-08-10": ["device-a", "device-b", "device-c"],
      "funnel:event:2026-08-10:onboarding_started": ["device-a", "device-b", "device-c"],
      "funnel:event:2026-08-10:wallet_auth_succeeded": ["device-a", "device-b"],
      "funnel:event:2026-08-10:claim_failed": ["device-a"],
    };
    const reader: FunnelReader = {
      scard: (async (key: string) => (sets[key] || []).length) as FunnelReader["scard"],
      sinter: (async (a: string, b: string) => (sets[a] || []).filter((id) => (sets[b] || []).includes(id))) as FunnelReader["sinter"],
    };
    const report = await computeFunnel(reader, { days: 1, now: NOW });
    expect(report.days[0]).toMatchObject({
      date: "2026-08-10",
      cohort: 3,
      steps: { onboarding_started: 3, wallet_auth_succeeded: 2, claim_failed: 1, proof_submitted: 0 },
    });
    expect(Object.keys(report.days[0].steps).sort()).toEqual([...FUNNEL_EVENTS].sort());
  });
});
