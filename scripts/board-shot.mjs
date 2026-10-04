#!/usr/bin/env node
// THE BOARD IN A REAL BROWSER, FED FROM A SAVED SNAPSHOT (2026-10-05).
//
// Opens a LOCAL dev server of this branch in headless Chromium and answers
// GET /api/tasks and GET /api/campaigns/company from saved files, so the page
// renders the saved board with this branch's code. That is a local double for the
// store. It takes two screenshots of the board and one of a company campaign page.
//
// Every request to a host other than the local server is BLOCKED and listed, so
// "nothing left this machine" is something the run shows instead of asserting.
//
//   # terminal 1, in the repo, no env file needed:
//   npx next dev -p 3467            # in a copy outside the repo tree, add --webpack
//   # terminal 2:
//   node scripts/board-shot.mjs --tasks <api_tasks.json> --campaigns <api_campaigns_company.json> --out <dir> [--base http://localhost:3467] [--campaign <id>]
//
// Needs the Chromium that Playwright downloads (npx playwright install chromium).
// The viewer is a made-up local identity written to the browser's local storage.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const BASE = arg("--base") ?? "http://localhost:3467";
const tasksFile = arg("--tasks");
const campaignsFile = arg("--campaigns");
const OUT = arg("--out");
if (!tasksFile || !campaignsFile || !OUT) { console.error("usage: board-shot.mjs --tasks <file> --campaigns <file> --out <dir> [--base http://localhost:3467] [--campaign <id>]"); process.exit(2); }
const baseHost = new URL(BASE).host;
if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseHost)) { console.error("--base must be a local server. This script never loads the live app: the page writes visit counters."); process.exit(2); }

const tasks = readFileSync(tasksFile, "utf8");
const campaignsRaw = readFileSync(campaignsFile, "utf8");
const campaigns = JSON.parse(campaignsRaw).campaigns ?? [];
const campaignId = arg("--campaign") ?? campaigns[0]?.id;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const blocked = new Map();
const pageErrors = [];

// Registered first, so the more specific routes below win (Playwright runs the
// most recently added matching route first).
await ctx.route("**/*", (r) => {
  const u = new URL(r.request().url());
  if (u.host === baseHost || u.protocol === "data:" || u.protocol === "blob:") return r.continue();
  blocked.set(u.host, (blocked.get(u.host) ?? 0) + 1);
  return r.abort();
});
await ctx.route("**/proof-image**", (r) => r.abort());
await ctx.route("**/api/campaigns/company/*", (r) => {
  const id = decodeURIComponent(new URL(r.request().url()).pathname.split("/").pop());
  const c = campaigns.find((x) => x.id === id);
  return c ? r.fulfill({ contentType: "application/json", body: JSON.stringify({ campaign: c, results: [] }) }) : r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
});
await ctx.route("**/api/campaigns/company", (r) => r.fulfill({ contentType: "application/json", body: campaignsRaw }));
await ctx.route("**/api/tasks", (r) => (r.request().method() === "GET" ? r.fulfill({ contentType: "application/json", body: tasks }) : r.abort()));

async function open(extra) {
  const seed = await ctx.newPage();
  await seed.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await seed.evaluate((piece) => {
    localStorage.setItem("relay_user_id", "demo_boardshot");
    localStorage.setItem("relay_verification_level", "dev");
    localStorage.setItem("relay_onboarded", "true");
    localStorage.setItem("relay_first_run_coach_dismissed", "true");
    if (piece) localStorage.setItem("favour_pending_piece", piece);
  }, extra ?? null);
  await seed.close();
  const p = await ctx.newPage();
  p.on("pageerror", (e) => pageErrors.push(e.message));
  await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await p.waitForTimeout(9000);
  return p;
}

const board = await open();
await board.screenshot({ path: join(OUT, "after-board-local-first-screen.png") });
await board.screenshot({ path: join(OUT, "after-board-local-full.png"), fullPage: true });
const text = await board.evaluate(() => document.body.innerText);
const heading = (text.match(/\d+ of \d+ open shown|\d+ open\b(?! now)/) ?? ["(not found)"])[0];
console.log(`Favours heading: ${heading}`);
console.log(`"Open a while" chips: ${(text.match(/Open a while/g) ?? []).length}`);
console.log(`"More company campaigns" on the board: ${text.includes("More company campaigns")}`);
for (const c of campaigns) console.log(`"${c.company}" on the board: ${text.includes(c.company)}`);

if (campaignId) {
  const page = await open(campaignId);
  await page.screenshot({ path: join(OUT, "company-campaign-ended-local.png"), fullPage: true });
  const t = await page.evaluate(() => document.body.innerText);
  console.log(`Campaign page says it has ended: ${t.includes("This campaign has ended.")}`);
  console.log(`Pieces marked Closed: ${(t.match(/\bClosed\b/g) ?? []).length}`);
}

console.log(`Page errors: ${pageErrors.length}`);
console.log(`Requests to other hosts, all blocked: ${blocked.size === 0 ? "none" : [...blocked.entries()].map(([h, n]) => `${h} (${n})`).join(", ")}`);
await browser.close();
