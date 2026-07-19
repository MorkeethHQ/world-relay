import Anthropic from "@anthropic-ai/sdk";
import { getRedis } from "./redis";
import { PROMPTS, promptForDate, type DailyPrompt } from "./daily";

// DAILY QUEST GENERATOR
//
// Writes tomorrow's top favour: a fresh question, a format, and a fun fact that
// only unlocks in the reveal. The hardcoded pool repeats every 14 days, which is
// fine for testing a loop and fatal for a daily ritual.
//
// THE SAFETY RULE THAT SHAPES THIS FILE: the daily prompt is the gate in front of
// the entire app. If generation produces junk, or the model is down, or the JSON
// is malformed, the gate must still open. Every failure path here falls back to
// the deterministic pool. A generated prompt is an UPGRADE, never a dependency.
//
// Cost is ~1 cheap call per day.

const MODEL = process.env.DAILY_PROMPT_MODEL || "claude-sonnet-5";
const RECENT_KEY = "daily:recent";
const RECENT_KEEP = 40;

// Formats rotate so the ritual does not feel like the same box every morning.
export const FORMATS = [
  { id: "this_or_that", brief: "a stark either/or about right now. Exactly 2 options." },
  { id: "spectrum", brief: "a 4-5 option question where the options form a spectrum (least to most)." },
  { id: "count", brief: "a number question about something countable in the user's immediate surroundings." },
  { id: "confession", brief: "a mildly self-revealing multiple choice about a habit today. 3-5 options, none judgemental." },
  { id: "rate", brief: "a 0-10 rating of something about today. MUST be type number (never 11 choice options)." },
  { id: "guess_the_world", brief: "a choice question where people will be genuinely surprised by the global split. 3-4 options." },
] as const;

export function formatForDate(date: string): (typeof FORMATS)[number] {
  let h = 0;
  for (let i = 0; i < date.length; i++) h = (h * 33 + date.charCodeAt(i)) >>> 0;
  return FORMATS[h % FORMATS.length];
}

// The constraint that decides whether the gate delights or locks someone out of
// their own app: it must be answerable ANYWHERE, in ~30 seconds, with nothing to
// look up, buy, visit or research. Location-dependent questions are great DATA
// and terrible GATES — they belong in the weekly mission.
const BANNED = /price|cost|how much.*(cost|pay)|shop|store|supermarket|receipt|landmark|museum|nearest|go outside|travel|look up|search|google/i;

export function validatePrompt(raw: unknown): DailyPrompt | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  const question = typeof p.question === "string" ? p.question.trim() : "";
  if (question.length < 8 || question.length > 110) return null;
  if (BANNED.test(question)) return null;
  // A question mark OR an imperative opener. The "rate" format is naturally
  // imperative ("Rate today out of 10.") and a bare ?-check rejected every
  // single one of them — the validator disagreeing with our own format spec.
  if (!question.includes("?") && !/^(rate|score|count|guess|pick|choose)\b/i.test(question)) return null;

  const type = p.type === "number" ? "number" : p.type === "choice" ? "choice" : null;
  if (!type) return null;

  const fact = typeof p.fact === "string" ? p.fact.trim().slice(0, 220) : undefined;
  const hint = typeof p.hint === "string" ? p.hint.trim().slice(0, 90) : undefined;
  const unit = typeof p.unit === "string" ? p.unit.trim().slice(0, 20) : undefined;

  if (type === "choice") {
    const options = Array.isArray(p.options)
      ? p.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => o.trim().slice(0, 24))
      : [];
    // 2-5 options: fewer is not a question, more does not fit a phone and
    // shatters the distribution into noise at low volume.
    if (options.length < 2 || options.length > 5) return null;
    if (new Set(options).size !== options.length) return null;
    return { date: "", question, type, options, ...(fact ? { fact } : {}), ...(hint ? { hint } : {}) };
  }

  return { date: "", question, type, ...(unit ? { unit } : {}), ...(fact ? { fact } : {}), ...(hint ? { hint } : {}) };
}

async function recentQuestions(): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.get(RECENT_KEY);
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.filter((q): q is string => typeof q === "string") : [];
  } catch {
    return [];
  }
}

async function rememberQuestion(question: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const recent = await recentQuestions();
  const next = [question, ...recent.filter((q) => q !== question)].slice(0, RECENT_KEEP);
  await redis.set(RECENT_KEY, JSON.stringify(next)).catch(() => {});
}

function normalise(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export async function generatePrompt(date: string): Promise<{ prompt: DailyPrompt; generated: boolean; reason?: string }> {
  const fallback = { prompt: promptForDate(date), generated: false };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ...fallback, reason: "no ANTHROPIC_API_KEY" };

  const format = formatForDate(date);
  const recent = await recentQuestions();
  const avoid = [...recent, ...PROMPTS.map((p) => p.question)].slice(0, 60);

  const system = `You write the single daily question for FAVOUR, a mini app inside World App where every user is a verified unique human.

Everyone on earth gets the SAME question on the same day, answers it, and then sees how the whole world answered. The question is the gate in front of the app, so it must be effortless.

HARD RULES:
- Answerable ANYWHERE in under 30 seconds. Nothing to look up, buy, visit, count precisely, or research.
- No prices, shops, landmarks, or anything requiring the user to move.
- Nothing that assumes a country, climate, religion, wealth level, or that the user is employed or online at a particular hour.
- Never sensitive: no health conditions, politics, sexuality, income, or anything a person would not answer honestly in public.
- The world's split should be genuinely INTERESTING or surprising. A question where 95% pick the same option is a bad question.
- Warm, direct, plain. No emoji. No hype. Short.

Return ONLY the JSON object. No preamble, no explanation, no code fence.

A 0-10 rating is ALWAYS type "number" — never a choice with 11 options.

JSON shape:
{"question": "...", "type": "choice"|"number", "options": ["..."], "unit": "...", "hint": "...", "fact": "..."}

- options: required for choice (2-5, short, no duplicates). Omit for number.
- unit: optional, for number questions (e.g. "hours").
- hint: optional, one short line easing the question ("Best guess is fine").
- fact: REQUIRED. One genuinely interesting true sentence related to the question, shown to the user only AFTER they answer, as the payoff. Must be accurate and non-obvious. No statistics you are unsure of.`;

  const user = `Write the question for ${date}.

Format for today: ${format.brief}

Do NOT reuse or lightly reword any of these:
${avoid.map((q) => `- ${q}`).join("\n")}`;

  try {
    const anthropic = new Anthropic({ apiKey: key });
    const response = await anthropic.messages.create({
      model: MODEL,
      // 400 truncated the JSON mid-object roughly 1 run in 3, which silently
      // demoted a good generation to the fallback pool. The fact sentence is the
      // long field; give it room.
      max_tokens: 900,
      system,
      messages: [{ role: "user", content: user }],
    });
    // Find the first TEXT block, not content[0]. The model can return a thinking
    // block first, in which case content[0].type is "thinking" and reading it
    // yields "" — which looked like "the model returned no JSON" and silently
    // demoted half of all generations to the fallback pool.
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    // A truncated or absent object must be a clean fallback, not a thrown parse
    // error buried in a catch that reports the wrong cause.
    if (start === -1 || end <= start) return { ...fallback, reason: "no JSON object in response" };

    const validated = validatePrompt(JSON.parse(text.slice(start, end + 1)));
    if (!validated) return { ...fallback, reason: "generated prompt failed validation" };

    // A reworded repeat is still a repeat, and a daily ritual dies of déjà vu.
    if (avoid.some((q) => normalise(q) === normalise(validated.question))) {
      return { ...fallback, reason: "generated a repeat" };
    }

    return { prompt: { ...validated, date }, generated: true };
  } catch (err) {
    // Model down, bad JSON, network — the gate still opens on the pool.
    return { ...fallback, reason: `generation failed: ${(err as Error).message}` };
  }
}

// Generate and store the prompt for `date`. Never overwrites one that already
// exists, so a re-run (or two overlapping cron ticks) cannot change the question
// out from under people who have already answered it.
export async function ensurePromptFor(date: string): Promise<{ stored: boolean; generated: boolean; question: string; reason?: string }> {
  const redis = getRedis();
  if (!redis) return { stored: false, generated: false, question: promptForDate(date).question, reason: "no store" };

  const existing = await redis.get(`daily:prompt:${date}`);
  if (existing) {
    const p = typeof existing === "string" ? JSON.parse(existing) : (existing as DailyPrompt);
    return { stored: false, generated: false, question: p.question, reason: "already set" };
  }

  const { prompt, generated, reason } = await generatePrompt(date);
  if (!generated) return { stored: false, generated: false, question: prompt.question, reason };

  await redis.set(`daily:prompt:${date}`, JSON.stringify(prompt));
  await rememberQuestion(prompt.question);
  return { stored: true, generated: true, question: prompt.question };
}
