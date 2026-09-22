// THE PERSON'S TIP (2026-09-22). When a proof does not pass, the person reads one
// short, kind line on what would make it pass, never the judge-facing reasoning.
// Display only: no verdict, credit or payout reads it. Its own module so the
// verify-proof route can use it while tests mock the verifier.

// Made safe to show a person: a string, no model tags, one short line,
// and never a word that shames. Anything else is dropped, and the caller falls
// back to a plain line for the category (personTip).
const SHAMING = /\b(lazy|spam|spammy|low[- ]effort|placeholder|garbage|junk|nonsense|stupid|lol|pathetic|useless|fake)\b/i;
export function cleanTip(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  let t = v.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < 8) return undefined;
  if (SHAMING.test(t)) return undefined;
  if (t.length > 160) {
    const cut = t.slice(0, 160);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    t = stop > 40 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "") + "…";
  }
  return t;
}

const FALLBACK_TIP: Record<string, string> = {
  photo: "Send a photo you took yourself that shows exactly what the favour asks for.",
  social: "Post it, then paste the link to your post (or a screenshot of it).",
  review: "Say what you really think, in a sentence about the thing asked.",
  feedback: "Answer the question itself, in a sentence of your own.",
  custom: "Answer the question itself, with a real detail from where you are.",
};
// What the person reads when a proof does not pass: the AI's own tip, or a plain
// line for the category. Never the judge-facing reasoning.
export function personTip(result: { verdict: string; tip?: string }, category?: string): string | null {
  if (result.verdict === "pass") return null;
  return cleanTip(result.tip) ?? FALLBACK_TIP[category ?? ""] ?? "Check what the favour asks for, then send proof that shows exactly that.";
}

