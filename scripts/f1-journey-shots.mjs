// F1 journey driver, 2026-09-08.
//
// Walks the whole requester -> participant loop in a real Chromium at phone
// width and writes the screenshots that prove it. Repeatable: run it again and
// it overwrites the same files.
//
// IT MUST NOT BE POINTED AT PRODUCTION DATA. Start the dev server with the KV
// credentials blanked and FAVOUR_MEMORY_STORE=1, so the store is the in-process
// MemoryRedis and no task this script creates can reach a real record:
//
//   KV_REST_API_URL= KV_REST_API_TOKEN= FAVOUR_MEMORY_STORE=1 npx next dev -p 3011
//   ADMIN_SECRET=$(grep '^ADMIN_SECRET=' .env.local | cut -d= -f2-) \
//     node scripts/f1-journey-shots.mjs
//
// ADMIN_SECRET is required: the real one-favour-per-poster-per-day cap in
// api/tasks refuses the second POST without the seed-secret path.
//
// The script refuses to run if the board already holds tasks, which is the
// cheapest available signal that it is talking to a populated (real) store.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.F1_BASE || "http://localhost:3011";
const OUT = "docs/assets/f1-2026-09-08";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const CAMPAIGN = "comeback-2026";
const NO_BRIEF_CAMPAIGN = "relay-launch";

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // Safety gate: an empty board means the in-memory store, not production.
  const existing = await fetch(`${BASE}/api/tasks`).then((r) => r.json());
  if ((existing.tasks || []).length > 0) {
    throw new Error(
      `Refusing to run: ${BASE} already has ${existing.tasks.length} tasks, so it is not an isolated in-memory server.`
    );
  }

  // --- Round trip, step 1: the requester posts their recurring campaign work ---
  // The poster is wallet-shaped on purpose: isPublicTask (task-serializer.ts)
  // hides any dev_/test identity from the board, so a dev_ poster creates a task
  // that exists and is invisible, which reads as a broken loop.
  const POSTER = "0xF1DEM0000000000000000000000000000000A5E1";
  // The requester posts its campaign work through the seed-secret path, the same
  // privileged path FAVOUR's own campaign furniture uses (api/tasks route.ts ->
  // resolvePostingPrivilege). Without it the second POST is refused by the real
  // "one favour a day" per-poster cap, which is a genuine product finding: a
  // company cannot post a multi-favour recurring campaign as an ordinary poster.
  const ADMIN = process.env.ADMIN_SECRET || "";
  const asks = [
    { description: "Photograph wherever you are right now — street, desk, window, anything real", category: "photo", points: 10 },
    { description: "Photograph one small good thing you did today", category: "photo", points: 10 },
    { description: "Tell us the one thing FAVOUR should build next (points only, and we read every one)", category: "feedback", points: 10 },
  ];
  const createdIds = [];
  for (const a of asks) {
    const created = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-seed-secret": ADMIN },
      body: JSON.stringify({
        poster: POSTER,
        description: a.description,
        location: "Anywhere",
        category: a.category,
        bountyUsdc: a.points,
        deadlineHours: 336,
        rewardType: "points",
        maxCompletions: 25,
        campaignId: CAMPAIGN,
      }),
    }).then((r) => r.json());
    if (!created?.task?.id) throw new Error(`create failed: ${JSON.stringify(created)}`);
    createdIds.push(created.task.id);
  }
  const taskId = createdIds[0];
  console.log("created tasks", createdIds.join(", "));

  // --- Round trip, step 2: it is on the board the participant reads ---
  const board = await fetch(`${BASE}/api/tasks`).then((r) => r.json());
  const onBoard = createdIds.every((id) => (board.tasks || []).some((t) => t.id === id));
  console.log("all created tasks visible on board:", onBoard, "board size:", (board.tasks || []).length);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // --- 1. The requester proposition, public and signed out ---
  await page.goto(`${BASE}/c/${CAMPAIGN}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(600);
  await shot(page, "01-proposition-who-is-asking");
  await page.evaluate(() => window.scrollBy(0, 700));
  await page.waitForTimeout(400);
  await shot(page, "02-proposition-task-and-proof");
  await page.evaluate(() => window.scrollBy(0, 760));
  await page.waitForTimeout(400);
  await shot(page, "03-proposition-reward-and-repeat");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/04-proposition-full-page.png`, fullPage: true });
  console.log("shot 04-proposition-full-page");

  // --- 2. The CTA must reach a working route ---
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "See the open favours" }).click();
  await page.waitForURL(/\?campaign=/, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot(page, "05-cta-lands-signin");

  // Browser preview sign-in (dev identity, no World App present).
  await page.getByRole("button", { name: /Continue|Sign in/ }).click();
  await page.waitForTimeout(3500);
  await shot(page, "06-campaign-after-signin");
  await page.evaluate(() => window.scrollBy(0, 620));
  await page.waitForTimeout(600);
  await shot(page, "07-campaign-favours-list");

  // --- 3. The participant opens the actual task ---
  // domcontentloaded, not networkidle: the task detail page polls for messages
  // and verification state, so the network never goes idle.
  await page.goto(`${BASE}/task/${taskId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  await shot(page, "08-task-detail-round-trip");

  // --- 4. The honest empty state for a campaign with no published brief ---
  await page.goto(`${BASE}/c/${NO_BRIEF_CAMPAIGN}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollBy(0, 380));
  await page.waitForTimeout(300);
  await shot(page, "09-empty-state-no-brief");

  // --- Desktop, to show the page holds at width ---
  const wide = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const wp = await wide.newPage();
  await wp.goto(`${BASE}/c/${CAMPAIGN}`, { waitUntil: "networkidle", timeout: 60000 });
  await wp.waitForTimeout(600);
  await wp.screenshot({ path: `${OUT}/10-proposition-desktop-1440.png` });
  console.log("shot 10-proposition-desktop-1440");

  await browser.close();
  console.log("\nROUND TRIP: created", createdIds.length, "tasks | all on board:", onBoard, "| detail shot of", taskId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
