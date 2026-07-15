import { timingSafeEqual } from "crypto";
import { getAgent } from "./agents";

// Posting privilege vs agent identity. Two separate concerns; keep them separate.
//
// The `agent:` poster prefix carries two unrelated meanings that must not be
// conflated:
//   1. "the platform seeded this" — needs the anti-spam exemption so campaigns can
//      be seeded.
//   2. "a registry agent posted this" — should drive that agent's
//      verificationPrompt (see AGENT_REGISTRY in agents.ts).
//
// The invariants enforced here:
//   - PRIVILEGE is granted only by an authenticated secret, or the owner address.
//     Never by a caller-supplied string. Inv 4: identity is proven, not claimed.
//   - IDENTITY comes from AGENT_REGISTRY. An id that is not in the registry is
//     surfaced in logs, never silently coerced to null.
//   - Registry membership grants NO privilege. Agent names are public, so treating
//     a known name as authority would just relocate the trust boundary onto a
//     guessable string. Auth is auth; identity is identity.
//
// Rollout follows the SESSION_ENFORCE precedent in session.ts: the gate is staged
// behind SEED_AUTH_ENFORCE so the seeding caller (which lives outside this repo)
// can be updated to send the header before enforcement begins, rather than having
// seeded campaign tasks start failing on deploy. auditPostingPrivilege shadow-logs
// each request that enforcement would reject, so the migration is measurable.
// Rollback is one env var.

export const SEED_SECRET_HEADER = "x-seed-secret";

export type PostingPrivilege = {
  /** Exempt from the board-quality gates and the free-points throttle. */
  isAdmin: boolean;
  /** A VALIDATED AGENT_REGISTRY id, or null. Drives verificationPrompt. */
  agentId: string | null;
  /** An agent id that is NOT in the registry. Never silently discarded. */
  unknownAgentId: string | null;
  /** True when admin was granted ONLY because enforcement is still off. */
  legacyExemptionUsed: boolean;
};

export function seedAuthEnforced(): boolean {
  return process.env.SEED_AUTH_ENFORCE === "true";
}

/** Constant-time compare; false on any length mismatch. */
function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function resolvePostingPrivilege(input: {
  poster: unknown;
  agentId: unknown;
  seedSecretHeader: string | null;
  adminSecret: string | undefined;
  ownerAddress: string;
  enforced: boolean;
}): PostingPrivilege {
  const { poster, agentId, seedSecretHeader, adminSecret, ownerAddress, enforced } = input;

  // Identity: an explicit agentId wins; otherwise read the poster prefix.
  const rawAgentId =
    typeof agentId === "string" && agentId.trim()
      ? agentId.trim()
      : typeof poster === "string" && poster.startsWith("agent:")
        ? poster.slice("agent:".length).trim()
        : null;

  const known = rawAgentId ? getAgent(rawAgentId) : null;

  // Privilege: authenticated secret, or the owner's own wallet. Never a string.
  const authedSeeder = secretMatches(seedSecretHeader, adminSecret);
  const isOwner =
    typeof poster === "string" && poster.toLowerCase() === ownerAddress.toLowerCase();

  // The pre-split rule: any "agent:"-prefixed poster was admin. Kept alive only
  // while dormant so the live seeding caller does not break on deploy.
  const legacyClaim = !!rawAgentId && !authedSeeder && !isOwner;
  const legacyExemptionUsed = legacyClaim && !enforced;

  return {
    isAdmin: authedSeeder || isOwner || legacyExemptionUsed,
    agentId: known && rawAgentId ? rawAgentId.toLowerCase() : null,
    unknownAgentId: rawAgentId && !known ? rawAgentId : null,
    legacyExemptionUsed,
  };
}

/**
 * Shadow audit, runs while enforcement is OFF (the session.ts pattern). Makes the
 * two live defects observable in logs before either gate is flipped on.
 */
export function auditPostingPrivilege(p: PostingPrivilege, poster: unknown, path = "/api/tasks"): void {
  if (p.unknownAgentId) {
    console.error(
      `[agents] UNKNOWN agentId="${p.unknownAgentId}" poster="${String(poster)}" path=${path} — ` +
        `not in AGENT_REGISTRY, so this task gets NO verificationPrompt and task.agent stays null.`
    );
  }
  if (p.legacyExemptionUsed) {
    console.warn(
      `[seed] UNAUTHENTICATED SEEDER poster="${String(poster)}" path=${path} enforced=false — ` +
        `this request would be DENIED once SEED_AUTH_ENFORCE=true. ` +
        `Update this caller to send the ${SEED_SECRET_HEADER} header.`
    );
  }
}
