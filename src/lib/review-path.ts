// WHO, IF ANYONE, LOOKS AT A FLAGGED PROOF (2026-10-05).
//
// The proof screen said "Waiting for a human check" and "People check it by
// hand" on every flagged points favour. For most of them no person could: the
// poster was a house agent, and the jury appeal takes photos only and no
// campaign favour. This file answers the question from the same gates the server
// uses, so the screen can only promise a review that exists for THIS proof.
// Pure, and safe to import from a client component.
import type { Task } from "./types";
import { isFunded, isRealMoney } from "./reward";
import { APPEAL_QUORUM, APPEAL_CLEAR_MAJORITY, isAppealable } from "./jury-appeal-rules";
import { asIfFlagged, houseReviewScope } from "./house-review-gate";

export type ReviewPathKind =
  | "welcome_jury"   // a Welcome favour (a person's own instance, or an original held claim): reviewers, text or photo
  | "house_jury"     // a written answer on a plain house favour: reviewers
  | "company_jury"   // a company piece under "AI check, judges on flagged photos"
  | "photo_jury"     // a plain points favour with a photo: the photo appeal
  | "poster"         // a person posted it and can accept or decline it
  | "none"           // nobody can review it: send a new proof
  | "none_money";    // money is involved: never decided by a person here

export type ReviewPath = {
  kind: ReviewPathKind;
  // True only when a person can open this exact proof and decide it.
  humanReview: boolean;
  headline: string;
  line: string;
  // Where the sender can follow it, if anywhere.
  follow: "welcome" | "history" | null;
};

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const JURY = `${APPEAL_QUORUM} qualified reviewers look at it and ${APPEAL_CLEAR_MAJORITY} must accept it.`;

// `task` is the favour as the proof screen holds it. `hasPhoto` and `hasNote` say
// what the proof carries. `companyRule` is the campaign's review rule when the
// favour is a company piece. The two reviewer gates are the server's own:
// houseReviewScope and isAppealable, asked about the favour as it would stand
// once this proof is flagged.
export function reviewPathFor(
  task: Task,
  hasPhoto: boolean,
  companyRule?: "ai" | "ai_and_jury" | null,
  hasNote: boolean = !hasPhoto,
): ReviewPath {
  const money = task.rewardType !== "points" || isRealMoney(task) || isFunded(task) || task.donOnChainId != null || !!task.escrowV2Address;
  if (money) {
    return {
      kind: "none_money", humanReview: false, follow: null,
      headline: "Not accepted yet",
      line: "The automatic check did not accept this proof. Money is released only by that check, never by a person here. Send a clearer proof. If none is accepted, the favour expires and the money goes back to the person who asked.",
    };
  }
  const flagged = asIfFlagged(task, null, hasPhoto, hasNote);
  const scope = houseReviewScope(flagged);
  if (scope === "welcome_instance" || scope === "welcome_source") {
    return {
      kind: "welcome_jury", humanReview: true, follow: "welcome",
      headline: "Sent to human review",
      line: `The automatic check was not sure. ${JURY} No points yet. They land only if it is accepted, and you can send a new proof at any time.`,
    };
  }
  if (scope === "house_text") {
    return {
      kind: "house_jury", humanReview: true, follow: null,
      headline: "Sent to human review",
      line: `The automatic check was not sure about your answer. ${JURY} No points yet. They land only if it is accepted, and you can send a new answer at any time.`,
    };
  }
  if (task.companyCampaignId) {
    if (companyRule === "ai_and_jury" && hasPhoto) {
      return {
        kind: "company_jury", humanReview: true, follow: "history",
        headline: "Sent to human review",
        line: `The automatic check was not sure. This campaign lets human reviewers decide a flagged photo. ${JURY} No points yet.`,
      };
    }
    return {
      kind: "none", humanReview: false, follow: null,
      headline: "Not accepted yet",
      line: hasPhoto
        ? "The automatic check did not accept this proof, and this campaign has no human review. No points were added. You can send a new proof."
        : "The automatic check did not accept this proof. Human reviewers on a company campaign decide photos only, so nobody will look at a written one. No points were added. You can send a new proof.",
    };
  }
  if (WALLET_RE.test(task.poster || "") && !task.campaignId) {
    return {
      kind: "poster", humanReview: true, follow: null,
      headline: "Waiting for the person who asked",
      line: "The automatic check was not sure, so the person who posted this favour decides. They have been told. No points yet, and you can send a new proof at any time.",
    };
  }
  if (isAppealable(flagged)) {
    return {
      kind: "photo_jury", humanReview: true, follow: null,
      headline: "Sent to human review",
      line: `The automatic check was not sure about your photo. ${JURY} No points yet.`,
    };
  }
  return {
    kind: "none", humanReview: false, follow: null,
    headline: "Not accepted yet",
    line: "The automatic check did not accept this proof. Nobody reviews this favour by hand. No points were added. You can send a new proof.",
  };
}
