// TRY IT WITH AGENTS, the local preview (Oscar, 10 Oct 2026: "I like Astra
// nvidia one, but maybe try Favour app or something usable", "micro animations,
// debating multi model"). The brief: FAVOUR-FLOW-BRIEF.md of 10 Oct 2026.
//
// EVERYTHING IN THIS FILE IS A STAND-IN. No model ran. No page was opened. The
// steps are the steps of FAVOUR's own post flow (/post), and the stops are
// written by hand to show what a trial would look like. The screens say so on
// every step with STANDIN_LINE. Nothing here is a measurement, and nothing here
// may be read by a route, a count, a reward or a board.

/** The flag. Off everywhere but the local review fixture. */
export function simPreviewOn(): boolean {
  return process.env.NEXT_PUBLIC_FAVOUR_SIM_PREVIEW === "1";
}

export const STANDIN_LINE = "Illustrative stand-in traces. No model trial has run in this preview.";
export const DEFAULT_TASK = "Start a review request from this product URL.";

export type Version = "base" | "candidate";
export type Step = { n: number; action: string; response: string };
export type Condition = {
  id: "a" | "b" | "c";
  name: string;
  model: string;
  tools: string;
  controller: string;
  cap: string;
};
export type Track = { condition: Condition["id"]; stopAt: number | null; why: string | null };

/** The six steps of the post flow, as a person does them today. */
export const STEPS: Step[] = [
  { n: 1, action: "Open the post page", response: "The page shows one field for a link." },
  { n: 2, action: "Paste the product URL", response: "The field takes the link." },
  { n: 3, action: "Press \"Show my app\"", response: "The app's name and one line appear on a card." },
  { n: 4, action: "Check the picture", response: "The card asks for a picture link when the page has none." },
  { n: 5, action: "Write what to review", response: "The ask field takes the text and counts it." },
  { n: 6, action: "Press \"Post for reviews\"", response: "The card says \"On FAVOUR\"." },
];

/** Three agent conditions. The settings are placeholders: a real run fills and freezes them. */
export const CONDITIONS: Condition[] = [
  { id: "a", name: "Condition A", model: "Small model, to be named", tools: "Browser", controller: "One attempt, 12 steps at most", cap: "Set before a real run" },
  { id: "b", name: "Condition B", model: "Mid model, to be named", tools: "Browser", controller: "One attempt, 12 steps at most", cap: "Set before a real run" },
  { id: "c", name: "Condition C", model: "Large model, to be named", tools: "Browser and page text", controller: "One attempt, 12 steps at most", cap: "Set before a real run" },
];

/** Where each stand-in track stops, on today's version and on the candidate. `null` is a finished task. */
export const TRACKS: Record<Version, Track[]> = {
  base: [
    { condition: "a", stopAt: 4, why: "The page had no share picture. The agent found no picture link to give and stopped." },
    { condition: "b", stopAt: null, why: null },
    { condition: "c", stopAt: 6, why: "The button answered \"Open FAVOUR in World App\". The agent had no sign-in." },
  ],
  candidate: [
    { condition: "a", stopAt: null, why: null },
    { condition: "b", stopAt: null, why: null },
    { condition: "c", stopAt: 6, why: "The button answered \"Open FAVOUR in World App\". The agent had no sign-in." },
  ],
};

/** The candidate, in one line. A stand-in change, not a change that exists. */
export const CANDIDATE_LINE = "Candidate: the picture step can be skipped.";

export type Claim = {
  condition: Condition["id"];
  says: string;
  /** The trace this claim points to, or null: a claim with no trace is a hypothesis. */
  trace: { condition: Condition["id"]; step: number } | null;
  challenges: Condition["id"];
  challenge: string;
  change: string;
};

export const DEBATE: Claim[] = [
  {
    condition: "a", says: "I stopped at the picture. Nothing told me the picture link was needed before I pressed the button.",
    trace: { condition: "a", step: 4 }, challenges: "c", challenge: "C calls sign-in the main problem. I never reached sign-in.",
    change: "Say on step 2 that a page with no picture needs a picture link.",
  },
  {
    condition: "b", says: "I finished. The picture field was clear to me because the card showed an empty frame.",
    trace: { condition: "b", step: 4 }, challenges: "a", challenge: "A's stop may be A's limit and not the page's fault. One run cannot tell.",
    change: "Change nothing on step 4. Run more attempts first.",
  },
  {
    condition: "c", says: "A builder outside World App will leave at the last button. That is the larger loss.",
    trace: null, challenges: "b", challenge: "B finished with a sign-in already in place. That hides the last step.",
    change: "Tell the person on step 1 that posting needs World App.",
  },
];

export type Outcome = "up" | "down" | "none";
/** The forecast for a held-out agent and the diff-reader's guess. Both are stand-ins; no forecast was sealed. */
export const FORECAST: { panel: Outcome; diffReader: Outcome; edit: string } = {
  panel: "up",
  diffReader: "none",
  edit: "Let the picture step be skipped, and say on step 1 that posting needs World App.",
};

export function finished(version: Version): number {
  return TRACKS[version].filter((t) => t.stopAt === null).length;
}

export function failedSteps(version: Version): number[] {
  return [...new Set(TRACKS[version].map((t) => t.stopAt).filter((n): n is number => n !== null))].sort((a, b) => a - b);
}

/** The first stop on a version: the earliest step any track stops at, or null when all finish. */
export function firstStop(version: Version): Track | null {
  const stopped = TRACKS[version].filter((t) => t.stopAt !== null);
  return stopped.length ? stopped.reduce((a, b) => ((a.stopAt as number) <= (b.stopAt as number) ? a : b)) : null;
}
