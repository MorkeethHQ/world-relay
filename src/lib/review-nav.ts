// MOVING BETWEEN FLAGGED PROOFS WITHOUT DECIDING THEM (2026-10-05). Pure.
//
// Seen in a real browser: the review page showed only the first card, and the
// only way past it was to vote on it. With 8 old held Welcome proofs ahead of a
// company proof, a reviewer had to cast 8 votes on proofs they had not come for.
// A reviewer may now step to the next or the previous proof, or straight to one.
// Stepping is local to the screen: it casts no vote, dismisses nothing and sends
// nothing to the server. The proof stays in everyone's queue.
//
// The page keeps its position in this one small state and changes it only
// through navReduce, so "skip sends no request" is a property of this file: it
// has no way to reach the network.
export type ReviewNav = { index: number; reason: string };
export type ReviewNavAction =
  | { type: "next"; count: number }
  | { type: "previous"; count: number }
  | { type: "select"; count: number; index: number }
  | { type: "reason"; value: string }
  // The deck was loaded again (first load, or after a decision or a stale card).
  | { type: "deck"; count: number };

export const START: ReviewNav = { index: 0, reason: "" };

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, Math.trunc(index) || 0), count - 1);
}

export function navReduce(state: ReviewNav, action: ReviewNavAction): ReviewNav {
  switch (action.type) {
    case "reason":
      return { ...state, reason: action.value };
    case "deck":
      // Stay where the reviewer was if that place still exists. The reason was
      // written about a proof that may no longer be the one shown, so it goes.
      return { index: clampIndex(state.index, action.count), reason: "" };
    case "next":
    case "previous":
    case "select": {
      if (action.count <= 0) return START;
      const at = clampIndex(state.index, action.count);
      const to = action.type === "select"
        ? clampIndex(action.index, action.count)
        // Wraps, so every proof in the deck can be reached from any other.
        : (at + (action.type === "next" ? 1 : action.count - 1)) % action.count;
      // A reason belongs to one proof. It never follows the reviewer to another.
      return to === at ? state : { index: to, reason: "" };
    }
  }
}

export function positionLabel(index: number, count: number): string {
  if (count <= 0) return "";
  return `Proof ${clampIndex(index, count) + 1} of ${count}`;
}

// The order proofs are offered in. Old held Welcome claims go last, so the
// proofs a reviewer most likely came for are not behind them. Nothing is left
// out, and the order within each group is the order the server gave.
export function orderReviewCards<T extends { source: "house" | "jury"; scope?: string }>(cards: T[]): T[] {
  const late = (c: T) => c.source === "house" && c.scope === "welcome_source";
  return [...cards.filter((c) => !late(c)), ...cards.filter(late)];
}
