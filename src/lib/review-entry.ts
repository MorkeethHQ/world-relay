// THE ONE "REVIEW FAVOURS" ENTRY ON THE BOARD (2026-10-05). Pure, client-safe.
//
// The board had two doors into the same deck: a "Review a proof" card and a
// REAL OR NOT banner. Oscar: "it should just be ONE clear feature". This builds
// the words on the single card from server counts. Every number is a real count
// and a zero prints nothing.
import { JUDGE_MIN_ACCURACY, JUDGE_MIN_GRADED } from "./jury-appeal-rules";

export type ReviewEntry = {
  title: string;
  line: string;
  flagged: string | null;
  qualification: string;
  cta: string;
};

export function reviewEntryFor(input: {
  waiting: number;
  flaggedWaiting: number;
  record: { judged: number; correct: number } | null;
  walletUser: boolean;
}): ReviewEntry {
  const { waiting, flaggedWaiting, record, walletUser } = input;
  const judged = record?.judged ?? 0;
  const correct = record?.correct ?? 0;
  const qualified = judged >= JUDGE_MIN_GRADED && correct / judged >= JUDGE_MIN_ACCURACY;
  const pct = Math.round(JUDGE_MIN_ACCURACY * 100);
  return {
    title: "Review favours",
    line: waiting > 0
      ? `${waiting} real ${waiting === 1 ? "proof" : "proofs"} to judge. Does the proof match what was asked? A correct call earns a point.`
      : "Judge real proofs people sent. Does the proof match what was asked? When no new proof is waiting, a practice round is ready and earns nothing.",
    flagged: flaggedWaiting > 0
      ? `${flaggedWaiting} flagged ${flaggedWaiting === 1 ? "proof waits" : "proofs wait"} for a human decision.`
      : null,
    qualification: !walletUser
      ? "Open FAVOUR in World App to review. Preview mode can look only."
      : qualified
        ? "You are a qualified reviewer. Your decision counts on flagged proofs."
        : `${Math.min(judged, JUDGE_MIN_GRADED)} of ${JUDGE_MIN_GRADED} graded calls${judged > 0 ? `, ${Math.round((correct / judged) * 100)}% right` : ""}. ${JUDGE_MIN_GRADED} calls at ${pct}% qualifies you to decide flagged proofs.`,
    cta: "Review favours",
  };
}
