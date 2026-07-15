import { timingSafeEqual } from "crypto";
import { getAgent } from "./agents";

// Posting privilege vs agent identity — two things that shared one namespace.
//
// `agent:` on POST /api/tasks has always meant two unrelated things:
//   1. "the platform seeded this" (poster: "agent:relay"). Its only job is to earn
//      the anti-spam exemption so campaigns can be seeded. Documented behaviour
//      (vault: 01 Projects/Relay/funding-campaign-flow.md:39,47).
//   2. "a registry agent posted this" (poster: "agent:shelfwatch", or an explicit
//      agentId). This should drive that agent's verificationPrompt.
//
// Privilege was keyed off `poster.startsWith("agent:")` and never validated against
// AGENT_REGISTRY, so (1) silently satisfied (2)'s code path. Two consequences, both
// live on prod as of 2026-07-15:
//   - `getAgent("relay")` returns null (no such key), so task.agent was null on
//     107/107 tasks and the agent layer has NEVER executed. Silently: no log, no 400.
//   - `isAdmin = !!resolvedAgentId` off a public, spoofable field, with no session
//     enforcement on this route, let ANY caller mint the exemption by typing "agent:".
//
// The split enforced here:
//   - PRIVILEGE comes from an authenticated secret (or the owner address), never
//     from a string a stranger can type.
//   - IDENTITY comes from AGENT_REGISTRY, and an id that isn't in it is surfaced
//     rather than silently nulled.
// Registry membership grants NO privilege: "agent:shelfwatch" typed by a stranger
// must not earn admin either. Auth is auth; identity is identity.
//
// Ships DORMANT behind SEED_AUTH_ENFORCE, mirroring the SESSION_ENFORCE precedent
// in session.ts: the live seeding caller lives outside this repo and posts
// `agent:relay` with no secret today. Enforcing before that caller sends the header
// would break the flow behind all 10 on-chain settlements. While dormant, the
// shadow log below makes every would-be denial visible.

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
      `[seed] LEGACY EXEMPTION poster="${String(poster)}" path=${path} enforced=false — ` +
        `admin granted off an unauthenticated "agent:" string. This request would be DENIED ` +
        `once SEED_AUTH_ENFORCE=true. Send the ${SEED_SECRET_HEADER} header.`
    );
  }
}
