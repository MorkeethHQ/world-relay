import type { TaskCategory } from "./types";

// ONE source for "what proof does this favour require".
//
// Written 2026-09-09. The rule already existed as `tierRequiresPhoto` inside
// Feed.tsx (a local function in a 3000-line client component), so the submit
// form knew the answer and no other surface could ask. A stranger reading a
// favour for the first time needs it more than the submit form does: the thing
// people get wrong is what counts as done. Feed.tsx now imports this.
//
// This is not board logic and not a money rule. It maps a category to the shape
// of evidence the submit form will demand, nothing else.

const PHOTO_CATEGORIES: TaskCategory[] = ["photo", "delivery", "errand", "check-in"];

export function requiresPhotoProof(category: string): boolean {
  return (PHOTO_CATEGORIES as string[]).includes(category);
}

export type ProofRequirement = {
  kind: "photo" | "text";
  // What the doer must produce. Second person, plain.
  label: string;
  // The shape of the slot the proof lands in, for the proof-slot device.
  shape: "frame" | "lines";
};

export function proofRequirement(category: string): ProofRequirement {
  return requiresPhotoProof(category)
    ? { kind: "photo", label: "A photo you take yourself", shape: "frame" }
    : { kind: "text", label: "An answer in your own words", shape: "lines" };
}

// What happens to the proof after it is sent. This is the product's real
// behaviour (CLAUDE.md: AI checks every proof; a flagged points-only proof can
// go to a human jury; money and campaign progress stay AI-pass-only), stated
// once so no surface has to paraphrase it.
export const PROOF_DESTINATION =
  "Your proof is checked by AI before it counts. A pass earns the reward. A close call goes to a jury of verified people, and you are told either way.";
