#!/usr/bin/env node
// THE BOARD A VISITOR WOULD GET, FROM A SAVED SNAPSHOT (2026-10-05).
//
// Feeds a saved copy of the public GET /api/tasks response (and, optionally, of
// GET /api/campaigns/company) through this branch's own board rules, for a
// signed-out visitor, with the clock pinned. It reads two files and prints. No
// store, no network, no env.
//
//   node scripts/board-from-snapshot.mjs --tasks <api_tasks.json> [--campaigns <api_campaigns_company.json>] [--at <ISO time>] [--json]
//
// --at defaults to now. To reproduce a saved board, pass the time the snapshot was
// fetched: what is stale depends on the clock.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const tasksFile = arg("--tasks");
if (!tasksFile) { console.error("usage: board-from-snapshot.mjs --tasks <api_tasks.json> [--campaigns <file>] [--at <ISO time>] [--json]"); process.exit(2); }
const now = arg("--at") ? Date.parse(arg("--at").trim()) : Date.now();
if (!Number.isFinite(now)) { console.error("--at is not a time"); process.exit(2); }

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "src") } });
const rank = await jiti.import(join(root, "src/lib/board-rank.ts"));
const { getFeaturedCampaign } = await jiti.import(join(root, "src/lib/campaigns.ts"));
const { rankCampaignCards } = await jiti.import(join(root, "src/lib/company-door.ts"));

const tasks = JSON.parse(readFileSync(tasksFile, "utf8")).tasks ?? [];
const campaigns = arg("--campaigns") ? JSON.parse(readFileSync(arg("--campaigns"), "utf8")).campaigns ?? [] : [];

const visible = tasks.filter((t) => rank.isBoardVisible(t, null, now));
const ranked = rank.rankBoard(visible, { userId: null, userLocation: null, now });
const shown = rank.leadWithDoable(rank.curateBoard(ranked, null, now), null);
const featured = getFeaturedCampaign(now)?.id ?? null;
const TIERS = ["MY_CLAIM", "FUNDED", "FEATURED", "POINTS", "FEEDBACK", "STALE"];
const row = (t) => ({
  id: t.id.slice(0, 8),
  tier: TIERS[rank.boardTier(t, null, featured, now)],
  stale: rank.isStale(t, now),
  ageDays: +((now - Date.parse(t.createdAt)) / 86400000).toFixed(1),
  points: t.bountyUsdc,
  description: t.description,
});
const cards = rankCampaignCards(campaigns, tasks, new Set(), now);
const result = {
  at: new Date(now).toISOString(),
  tasksInSnapshot: tasks.length,
  open: tasks.filter((t) => t.status === "open").length,
  heading: rank.boardCountLabel(shown.length, tasks.filter((t) => t.status === "open").length),
  shown: shown.map(row),
  leftOut: ranked.filter((t) => !shown.includes(t)).map(row),
  featuredHouseCampaign: featured,
  companyCampaigns: { lead: cards.lead.map((c) => c.company), rest: cards.rest.map((c) => c.company), ended: cards.ended.map((c) => c.company) },
};

if (argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 1));
} else {
  console.log(`Board at ${result.at}, signed out, from ${tasksFile}`);
  console.log(`Favours heading: ${result.heading}`);
  console.log(`\nShown (${result.shown.length}):`);
  for (const r of result.shown) console.log(`  ${r.id}  ${r.tier.padEnd(8)} ${String(r.ageDays).padStart(5)}d ${r.stale ? "Open a while " : "             "}${r.description.slice(0, 70)}`);
  console.log(`\nLeft out of the default list (${result.leftOut.length}):`);
  for (const r of result.leftOut) console.log(`  ${r.id}  ${r.tier.padEnd(8)} ${String(r.ageDays).padStart(5)}d ${r.description.slice(0, 70)}`);
  console.log(`\nFeatured house campaign: ${result.featuredHouseCampaign ?? "none"}`);
  console.log(`Company campaigns: lead [${result.companyCampaigns.lead.join(", ")}]  rest [${result.companyCampaigns.rest.join(", ")}]  ended [${result.companyCampaigns.ended.join(", ")}]`);
}
