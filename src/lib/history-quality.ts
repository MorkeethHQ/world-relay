// WHICH FINISHED FAVOURS HISTORY SHOWS (Oscar, 8 Oct 2026: "history should still
// remain, but we can remove the bad ones").
//
// History stays. A finished favour is left out of the public list when it is
// plainly bad. Nothing is deleted: the favour stays stored, and points or money
// already paid are not touched. Each reason is one a stranger can check:
//   - the check FAILED. A flag is not a fail: a finished favour that still reads
//     "flag" was cleared by a jury of people (jury-appeal.ts pays and leaves the
//     verdict as it was), and an old favour may carry no result at all. Both stay.
//   - the ask is not a real sentence: too short, or only a wallet address or link
//   - there is no proof at all: no note and no picture
// Pure. The reason is returned so a count per reason can be shown to Oscar.

export type HistoryReason = "check_failed" | "ask_not_a_sentence" | "no_proof";

type HistoryTask = {
  description?: string | null;
  proofNote?: string | null;
  proofImageUrl?: string | null;
  proofImages?: unknown;
  verificationResult?: { verdict?: string | null } | null;
};

export const ASK_MIN_LETTERS = 12;
export const ASK_MIN_WORDS = 3;

export function historyReason(t: HistoryTask): HistoryReason | null {
  if (t.verificationResult?.verdict === "fail") return "check_failed";
  const ask = (t.description || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/0x[0-9a-fA-F]{20,}/g, " ")
    .trim();
  const letters = (ask.match(/\p{L}/gu) || []).length;
  const words = ask.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length;
  // Languages written without spaces count by letters alone.
  if (letters < ASK_MIN_LETTERS || (words < ASK_MIN_WORDS && letters < ASK_MIN_LETTERS * 2)) return "ask_not_a_sentence";
  const hasPicture = !!t.proofImageUrl || (Array.isArray(t.proofImages) && t.proofImages.length > 0);
  if (!hasPicture && !(t.proofNote || "").trim()) return "no_proof";
  return null;
}

export function showInHistory(t: HistoryTask): boolean {
  return historyReason(t) === null;
}
