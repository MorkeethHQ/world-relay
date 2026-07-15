import { describe, it, expect } from "vitest";
import { resolvePostingPrivilege } from "@/lib/seeder";

// Behavioural cover for the two live defects found on prod 2026-07-15:
//   1. `isAdmin = !!resolvedAgentId` granted the anti-spam exemption off an
//      unvalidated, public, spoofable `poster` string.
//   2. `getAgent("relay")` returned null silently, so task.agent was null on
//      107/107 tasks and the agent layer never executed.
// Claim 3 (the safety net) is the seeding-flow regression: the documented
// `agent:relay` flow behind all 10 on-chain settlements must keep working while
// SEED_AUTH_ENFORCE is off.

const OWNER = "0x1101158041fd96f21cbcbb0e752a9a2303e6d70e";
const SECRET = "s3cret-seed-key";

const resolve = (o: Partial<Parameters<typeof resolvePostingPrivilege>[0]>) =>
  resolvePostingPrivilege({
    poster: undefined,
    agentId: undefined,
    seedSecretHeader: null,
    adminSecret: SECRET,
    ownerAddress: OWNER,
    enforced: false,
    ...o,
  });

describe("Claim 1: privilege comes from auth, never from a public string", () => {
  it("ENFORCED: a stranger typing agent: earns NO exemption", () => {
    const p = resolve({ poster: "agent:relay", enforced: true });
    expect(p.isAdmin).toBe(false);
  });

  it("ENFORCED: even a REAL registry id earns no exemption without the secret", () => {
    // Registry membership is identity, not authority. Otherwise the bypass just
    // moves to whichever agent names are public.
    const p = resolve({ poster: "agent:shelfwatch", enforced: true });
    expect(p.isAdmin).toBe(false);
    expect(p.agentId).toBe("shelfwatch");
  });

  it("ENFORCED: the correct seed secret DOES earn the exemption", () => {
    const p = resolve({ poster: "agent:relay", seedSecretHeader: SECRET, enforced: true });
    expect(p.isAdmin).toBe(true);
    expect(p.legacyExemptionUsed).toBe(false);
  });

  it("ENFORCED: a wrong secret earns nothing", () => {
    const p = resolve({ poster: "agent:relay", seedSecretHeader: "wrong", enforced: true });
    expect(p.isAdmin).toBe(false);
  });

  it("the owner address still earns the exemption without a header", () => {
    expect(resolve({ poster: OWNER, enforced: true }).isAdmin).toBe(true);
    expect(resolve({ poster: OWNER.toUpperCase(), enforced: true }).isAdmin).toBe(true);
  });

  it("a plain wallet earns nothing, enforced or not", () => {
    for (const enforced of [true, false]) {
      expect(resolve({ poster: "0xdeadbeef", enforced }).isAdmin).toBe(false);
    }
  });

  it("an empty/whitespace agentId is not a privilege claim", () => {
    expect(resolve({ agentId: "   ", enforced: false }).isAdmin).toBe(false);
    expect(resolve({ poster: "agent:", enforced: false }).isAdmin).toBe(false);
  });

  it("no configured adminSecret cannot be satisfied by an empty header", () => {
    const p = resolvePostingPrivilege({
      poster: "agent:relay",
      agentId: undefined,
      seedSecretHeader: "",
      adminSecret: undefined,
      ownerAddress: OWNER,
      enforced: true,
    });
    expect(p.isAdmin).toBe(false);
  });
});

describe("Claim 2: an unknown agent id is never silently null", () => {
  it("surfaces relay as unknown rather than swallowing it", () => {
    const p = resolve({ poster: "agent:relay" });
    expect(p.agentId).toBeNull();
    expect(p.unknownAgentId).toBe("relay");
  });

  it("resolves a real registry agent and reports no unknown", () => {
    const p = resolve({ poster: "agent:shelfwatch" });
    expect(p.agentId).toBe("shelfwatch");
    expect(p.unknownAgentId).toBeNull();
  });

  it("an explicit agentId wins over the poster prefix", () => {
    const p = resolve({ poster: "agent:relay", agentId: "freshmap" });
    expect(p.agentId).toBe("freshmap");
    expect(p.unknownAgentId).toBeNull();
  });

  it("agent ids are case-insensitive and normalised", () => {
    const p = resolve({ poster: "agent:ShelfWatch" });
    expect(p.agentId).toBe("shelfwatch");
  });

  it("a non-agent poster claims no identity at all", () => {
    const p = resolve({ poster: "0xdeadbeef" });
    expect(p.agentId).toBeNull();
    expect(p.unknownAgentId).toBeNull();
  });
});

describe("Claim 3 (safety net): the live agent:relay seeding flow still works", () => {
  it("DORMANT: agent:relay keeps its exemption, exactly as prod does today", () => {
    const p = resolve({ poster: "agent:relay", enforced: false });
    expect(p.isAdmin).toBe(true);
    expect(p.legacyExemptionUsed).toBe(true);
  });

  it("DORMANT: the legacy grant is flagged so it is visible before the flip", () => {
    expect(resolve({ poster: "agent:relay", enforced: false }).legacyExemptionUsed).toBe(true);
    // An authenticated seeder is NOT legacy, even while dormant.
    expect(
      resolve({ poster: "agent:relay", seedSecretHeader: SECRET, enforced: false }).legacyExemptionUsed
    ).toBe(false);
    // The owner is not legacy either.
    expect(resolve({ poster: OWNER, enforced: false }).legacyExemptionUsed).toBe(false);
  });

  it("the flip is the ONLY behaviour change for the seeding caller", () => {
    const dormant = resolve({ poster: "agent:relay", enforced: false });
    const enforced = resolve({ poster: "agent:relay", enforced: true });
    expect(dormant.isAdmin).toBe(true);
    expect(enforced.isAdmin).toBe(false);
    // Identity resolution is unaffected by the flag either way.
    expect(dormant.agentId).toBe(enforced.agentId);
    expect(dormant.unknownAgentId).toBe(enforced.unknownAgentId);
  });

  it("once the caller sends the secret, the flip is a no-op for it", () => {
    const before = resolve({ poster: "agent:relay", seedSecretHeader: SECRET, enforced: false });
    const after = resolve({ poster: "agent:relay", seedSecretHeader: SECRET, enforced: true });
    expect(before.isAdmin).toBe(true);
    expect(after.isAdmin).toBe(true);
  });
});
