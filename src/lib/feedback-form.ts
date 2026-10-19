// STRUCTURED FEEDBACK (Oscar, 12 Oct 2026: "Feedback is structured and
// interactive, not only free text: is it slop, design, who is the user, what is
// confusing"). The form's answers become the proof note the existing
// /api/verify-proof route already accepts (a note with no photo). Pure.

export const WORKED = ["Yes", "Partly", "No"] as const;
export const FEEL = ["Clean", "Rough", "Slop"] as const;
export const DESIGN_MAX = 5;
export const FIX_MIN_WORDS = 8;
export const LINE_MAX = 200;
export const FIX_MAX = 500;

export type FeedbackAnswers = {
  worked: (typeof WORKED)[number] | null;
  feel: (typeof FEEL)[number] | null;
  design: number | null; // 1 to DESIGN_MAX
  forWhom: string;
  confusing: string;
  fix: string;
};

export const EMPTY_FEEDBACK: FeedbackAnswers = { worked: null, feel: null, design: null, forWhom: "", confusing: "", fix: "" };

export function words(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/** Why the feedback cannot be sent yet, in the order the screen asks, or null. */
export function feedbackReason(a: FeedbackAnswers): string | null {
  if (!a.worked) return "Say whether it worked.";
  if (!a.feel) return "Say how it feels.";
  if (!a.design) return "Rate the design, 1 to 5.";
  if (!a.forWhom.trim()) return "Say who this is for.";
  if (!a.confusing.trim()) return "Say what confused you first.";
  if (words(a.fix) < FIX_MIN_WORDS) return `Name one thing to fix, in at least ${FIX_MIN_WORDS} words. You have ${words(a.fix)}.`;
  return null;
}

/** The note the AI check reads. One line per answer, plain words. Under 1000 chars. */
export function feedbackNote(a: FeedbackAnswers, productName: string): string {
  const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
  return [
    `Feedback on ${clip(productName, 80)}.`,
    `Worked: ${a.worked ?? "?"}.`,
    `Feels: ${a.feel ?? "?"}.`,
    `Design: ${a.design ?? "?"} of ${DESIGN_MAX}.`,
    `For: ${clip(a.forWhom, LINE_MAX)}.`,
    `Confusing first: ${clip(a.confusing, LINE_MAX)}.`,
    `Fix first: ${clip(a.fix, FIX_MAX)}.`,
  ].join("\n").slice(0, 1000);
}
