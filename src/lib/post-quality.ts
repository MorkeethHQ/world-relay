/**
 * Deterministic gibberish gate for USER-authored posts.
 *
 * Born 2026-07-31: "Hhfthhcucucyx" went live on the public board with a $1
 * reward label. Generated posts are already judged by their own pipeline;
 * this gate covers the human path with cheap, deterministic checks — no LLM
 * in the hot path (the REAL-OR-NOT judge is the roadmap item for deeper
 * quality, see escrow-v2-design.md).
 *
 * Philosophy: reject only what no honest favour description looks like.
 * Every rule is a structural property of keyboard-mash, not a vocabulary
 * judgment, so real requests in any Latin-script language pass. Non-Latin
 * scripts skip the letter-statistics rules (they'd be meaningless) and only
 * face the structural ones.
 */

const VOWELS = new Set("aeiouyàáâäåæèéêëìíîïòóôöøùúûüœ");

/** Letters a-z + accented Latin. */
function latinLetters(s: string): string[] {
  return Array.from(s.toLowerCase()).filter((c) => /[a-zà-öø-ÿœ]/.test(c));
}

/** Longest consonant run WITHIN a word — any non-letter breaks the run, so
 *  adjacent words ("first. Screenshots") can never combine into a false hit. */
function longestConsonantRun(text: string): number {
  let run = 0;
  let max = 0;
  for (const c of text.toLowerCase()) {
    if (!/[a-zà-öø-ÿœ]/.test(c)) {
      run = 0;
      continue;
    }
    run = VOWELS.has(c) ? 0 : run + 1;
    if (run > max) max = run;
  }
  return max;
}

function longestSameCharRun(s: string): number {
  let max = 0;
  let run = 0;
  let prev = "";
  for (const c of s.toLowerCase()) {
    run = c === prev ? run + 1 : 1;
    prev = c;
    if (run > max) max = run;
  }
  return max;
}

/**
 * Returns a human-readable rejection reason, or null when the text is
 * acceptable. Applied to user post descriptions AFTER the existing
 * min-length and template-copy gates.
 */
export function gibberishReason(description: string): string | null {
  const text = description.trim();
  const words = text.split(/\s+/).filter(Boolean);

  // A favour is an instruction to another human. One token is never that.
  if (words.length < 2) {
    return "Describe the favour in a sentence — what should someone actually do, and what counts as proof?";
  }

  // Keyboard-mash detector: same character 5+ times in a row ("aaaaaaa").
  if (longestSameCharRun(text) >= 5) {
    return "That looks like accidental input. Describe the favour in a real sentence.";
  }

  const letters = latinLetters(text);
  // Mostly non-Latin text (or numbers/emoji): structural checks above suffice.
  if (letters.length < 8 || letters.length < text.replace(/\s/g, "").length * 0.5) {
    return null;
  }

  // Latin-script statistics. Honest sentences sit well inside these bounds:
  //  - vowel ratio: English prose ≈ 0.35-0.45; "Hhfthhcucucyx" = 0.23.
  //  - consonant runs: real words rarely exceed 4 ("strengths" = 5 is the
  //    famous outlier, so the trigger is 6+ to stay honest-friendly).
  const vowelCount = letters.filter((c) => VOWELS.has(c)).length;
  const vowelRatio = vowelCount / letters.length;
  if (vowelRatio < 0.25 || vowelRatio > 0.85) {
    return "That reads like random letters. Describe the favour so a runner knows what to do.";
  }
  if (longestConsonantRun(text) >= 6) {
    return "That reads like random letters. Describe the favour so a runner knows what to do.";
  }

  return null;
}
