// WHAT A PERSON IS TOLD WHEN THE CHECKING SERVICE DID NOT JUDGE THEIR PROOF
// (2026-10-05). Pure, and safe to import from a client component, so the server
// and the screen use the same words.
//
// Production logs for nine requests showed the provider refusing every call for
// an account reason, for more than a day, while the app answered "flagged". The
// first repair answered 503 with a line that ended "Send it again in a moment".
// That promised a recovery nobody could promise. The rules for these words:
//   - they state what happened to THIS proof: not judged, no points changed;
//   - they say the fault is the service's and not the proof's;
//   - they give no time, and say that none can be given;
//   - they name no provider, no account and no cause. The cause is in the
//     operator log (console.error in the proof route) and nowhere a contributor
//     can read.
export const CHECK_UNAVAILABLE_CODE = "check_unavailable" as const;

export const CHECK_UNAVAILABLE_ERROR =
  "The checking service is not working right now, so your proof was not judged. No points were added or taken away. This is about the service, not about your proof. We cannot say when it will work again.";

// WHERE THE PROOF IS NOW, three answers and never a guess (review, 5 Oct 2026).
//   true   CONFIRMED: this person already held the favour, and the row was read
//          back still theirs with the new proof on it.
//   false  CONFIRMED: the proof is not attached to this favour. Either nothing
//          was written to it, or it is open again with no proof. An uploaded
//          blob may still exist; this does not promise deletion from storage.
//   null   NOT CONFIRMED: the store did not confirm either. The first version
//          folded this into `false`, so the screen said "FAVOUR did not keep
//          them" about a proof it could not account for.
export type ProofSaved = boolean | null;

export function checkUnavailableBody(proofSaved: ProofSaved) {
  return { error: CHECK_UNAVAILABLE_ERROR, code: CHECK_UNAVAILABLE_CODE, proofSaved };
}

// What a response says about the proof. Anything but a literal true or false,
// a missing field included, is "not confirmed".
export function readProofSaved(value: unknown): ProofSaved {
  return value === true ? true : value === false ? false : null;
}

// The second line on the screen. It says "saved" only when that is confirmed,
// "not saved to this favour" only when that is confirmed, and otherwise says what is known:
// the note and photo are on this screen.
export function proofKeptLine(proofSaved: ProofSaved): string {
  if (proofSaved === true) return "Your proof is saved on this favour without a result. It is still yours, and you can replace it.";
  if (proofSaved === false) return "Your response is still here for retry, but it was not saved to this favour. Keep this screen open if you want to try again.";
  return "We cannot confirm whether FAVOUR has your proof, or whether your place on this favour changed. Your note and photo are still on this screen.";
}

export function proofKeptLabel(proofSaved: ProofSaved): string {
  return proofSaved === true ? "Saved, not judged" : proofSaved === false ? "Not saved to this favour" : "Not confirmed";
}

// Trying again is always possible. Whether it works depends on the service, and
// the screen says that instead of implying it will.
export const TRY_AGAIN_LINE = "You can try again now. It will only be judged once the checking service works.";
