/**
 * Content generator: theme in, seed-ready campaign content out.
 *
 *   npx tsx scripts/generate-campaign.ts "world cup final" --tasks 5 --polls 3
 *   npx tsx scripts/generate-campaign.ts "prove paris" --tasks 8 --polls 2 --id prove-paris --seed-polls
 *
 * Produces:
 *  - scripts/batches/<id>.json        fund-batch-ready task batch (seed with
 *    `npx tsx scripts/fund-batch.ts scripts/batches/<id>.json --live` after review)
 *  - a campaigns.ts config snippet printed to stdout (paste + review)
 *  - poll payloads; --seed-polls POSTs them to prod as the relayer
 *
 * Deliberate boundary: polls seed directly (reversible, no money), TASKS always
 * go through the reviewed fund-batch flow — never auto-seeded from here.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";

config({ path: resolve(__dirname, "../.env.local") });

const APP_URL = "https://world-relay.vercel.app";
const RELAYER = "0x1101158041Fd96f21CBcbb0E752a9A2303E6D70e";
const CATEGORIES = ["photo", "check-in", "custom", "feedback", "review", "social"];

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const theme = process.argv[2];
  if (!theme || theme.startsWith("--")) {
    console.error('Usage: npx tsx scripts/generate-campaign.ts "<theme>" [--tasks N] [--polls N] [--id slug] [--seed-polls]');
    process.exit(1);
  }
  const nTasks = Number(arg("--tasks", "5"));
  const nPolls = Number(arg("--polls", "2"));
  const id = arg("--id", theme.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  const seedPolls = process.argv.includes("--seed-polls");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  console.log(`Generating "${theme}" -> ${nTasks} tasks + ${nPolls} polls (campaign id: ${id})...`);

  const prompt = `You write content for FAVOUR, a World App mini-app where verified humans complete small real-world favours, prove them with a photo, and an AI verifies the proof.

House rules (hard constraints):
- Every task description states the PROOF SPEC inside the description: what to photograph, what must be visible, and what goes in the proof note. One physical action per task.
- Categories must be one of: ${CATEGORIES.join(", ")}. Favour photo/check-in/review over feedback (max 1 feedback task per batch).
- Points 5-10 per task (integer, stored in bountyUsdc with rewardType points).
- Voice: warm, direct, zero hype, no emojis, no "amazing/exciting". Tasks doable anywhere unless the theme is a place.
- Polls: punchy question under 60 chars, 3-4 short options, no duplicate of the tasks.

Theme: "${theme}"

Return PURE JSON, no markdown fences:
{
  "tasks": [{"description": "...", "location": "Anywhere", "category": "photo", "points": 5}],
  "polls": [{"question": "...", "options": ["...", "..."], "category": "fun", "durationHours": 168}],
  "campaign": {"name": "...", "tagline": "... (under 70 chars)", "description": "... (2-3 sentences, honest, states points not dollars)"}
}
Exactly ${nTasks} tasks and ${nPolls} polls.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  if (!text.trim()) {
    console.error(`Empty model response (stop_reason: ${msg.stop_reason}). Raw content blocks: ${msg.content.map((b) => b.type).join(",")}`);
    process.exit(1);
  }
  const clean = text.replace(/^[\s\S]*?(\{)/, "$1").replace(/```\s*$/, "").trim();
  let gen;
  try {
    gen = JSON.parse(clean);
  } catch {
    console.error(`Model returned non-JSON (stop_reason: ${msg.stop_reason}). First 400 chars:\n${text.slice(0, 400)}`);
    process.exit(1);
  }

  // Validate against the same rules fund-batch enforces.
  const errors: string[] = [];
  for (const [i, t] of gen.tasks.entries()) {
    if (!CATEGORIES.includes(t.category)) errors.push(`task ${i}: bad category ${t.category}`);
    if (!(t.points >= 1 && t.points <= 10)) errors.push(`task ${i}: points ${t.points} outside 1-10`);
    if (!t.description || t.description.length < 40) errors.push(`task ${i}: description too thin for a proof spec`);
  }
  const feedbackCount = gen.tasks.filter((t: { category: string }) => t.category === "feedback").length;
  if (feedbackCount > 1) errors.push(`${feedbackCount} feedback tasks (max 1 — board rules)`);
  if (errors.length) {
    console.error("Generated batch failed validation:\n  " + errors.join("\n  "));
    process.exit(1);
  }

  // fund-batch-ready file
  const batch = {
    baseUrl: APP_URL,
    tasks: gen.tasks.map((t: { description: string; location: string; category: string; points: number }) => ({
      description: t.description,
      location: t.location || "Anywhere",
      category: t.category,
      bountyUsdc: t.points,
      rewardType: "points",
      deadlineHours: 720,
      maxCompletions: 500,
      campaignId: id,
    })),
  };
  mkdirSync(resolve(__dirname, "batches"), { recursive: true });
  const outPath = resolve(__dirname, `batches/${id}.json`);
  writeFileSync(outPath, JSON.stringify(batch, null, 2));

  console.log(`\nTASKS -> ${outPath}`);
  for (const t of batch.tasks) console.log(`  [${t.bountyUsdc} pts/${t.category}] ${t.description.slice(0, 80)}`);
  console.log(`  Review, then: npx tsx scripts/fund-batch.ts scripts/batches/${id}.json --live`);

  console.log(`\nCAMPAIGN SNIPPET (paste into src/lib/campaigns.ts, review copy + hero):`);
  console.log(JSON.stringify({
    id,
    name: gen.campaign.name,
    brand: "FAVOUR",
    tagline: gen.campaign.tagline,
    description: gen.campaign.description,
    heroGradient: "from-gray-900 via-gray-800 to-gray-700",
    accentColor: "#191C20",
    icon: "⭐",
    totalBudget: 0,
    rewardPerTask: Math.max(...batch.tasks.map((t: { bountyUsdc: number }) => t.bountyUsdc)),
    rewardKind: "points",
    taskCount: batch.tasks.length,
    categories: [...new Set(batch.tasks.map((t: { category: string }) => t.category))],
    taskDescriptions: batch.tasks.map((t: { description: string }) => t.description.slice(0, 60)),
    location: "Worldwide",
    endsAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
    featured: false,
  }, null, 2));

  console.log(`\nPOLLS${seedPolls ? " (seeding to prod as relayer)" : " (dry, re-run with --seed-polls to post)"}:`);
  for (const p of gen.polls) {
    console.log(`  "${p.question}" [${p.options.join(" | ")}]`);
    if (seedPolls) {
      const res = await fetch(`${APP_URL}/api/polls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: p.question,
          options: p.options,
          creator: RELAYER,
          category: p.category || "fun",
          durationHours: p.durationHours || 168,
        }),
      });
      const data = await res.json().catch(() => ({}));
      console.log(res.ok ? `    seeded: ${data.poll?.id || "ok"}` : `    FAILED ${res.status}: ${JSON.stringify(data)}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
