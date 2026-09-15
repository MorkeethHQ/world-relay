/** Client-safe jury availability labels — no Redis / server imports. */

export const JURY_COMPOSE_FLOOR = 2;

export type JuryAvailability = "deck" | "exhausted" | "empty";

/**
 * Floor-accurate copy for exhausted/empty. A single leftover proof is still
 * below the compose floor — never claim "every proof" or "no proofs" when the
 * counts say otherwise. Own contributions never enter the jury pool, so copy
 * must not promise that doing your own favour unlocks your next deck.
 */
export function juryAvailabilityCopy(
  availability: JuryAvailability,
  eligibleCount: number,
  baseCount: number
): { headline: string; detail: string; bridgeHint: string } {
  const floor = JURY_COMPOSE_FLOOR;
  if (availability === "empty") {
    if (baseCount <= 0) {
      return {
        headline: "No proofs yet",
        detail: "The pool has no eligible proofs to judge right now.",
        bridgeHint:
          "A quick favour can mint a proof for the pool. Your own contributions never appear in your jury deck.",
      };
    }
    return {
      headline: "Not enough proofs for a deck",
      detail: `A deck needs at least ${floor} eligible proofs; only ${baseCount} ${
        baseCount === 1 ? "is" : "are"
      } available right now.`,
      bridgeHint:
        "A quick favour can add supply for others to judge. Judging never includes your own favours or proofs.",
    };
  }
  if (availability === "exhausted") {
    if (eligibleCount <= 0) {
      return {
        headline: "Thanks for keeping FAVOUR human",
        detail: "You have judged every proof currently available to you.",
        bridgeHint:
          "New proofs land when others complete favours. Your own work never unlocks your next deck.",
      };
    }
    return {
      headline: "Thanks for keeping FAVOUR human",
      detail: `Fewer than ${floor} unjudged proofs remain (${eligibleCount} left) — not enough to build another deck.`,
      bridgeHint:
        "New proofs land when others complete favours. Your own work never unlocks your next deck.",
    };
  }
  return {
    headline: "",
    detail: "",
    bridgeHint: "",
  };
}
