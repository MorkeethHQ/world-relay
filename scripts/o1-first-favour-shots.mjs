// O1 driver, 2026-09-09: the cold journey, in a real Chromium.
//
// Walks a stranger's path: first screen, the request opened, how to fulfil it,
// the reward, the reason to return , plus the empty state, the board-error
// state and a 404. Repeatable: it overwrites the same files.
//
// IT MUST NOT BE POINTED AT PRODUCTION DATA. Start the dev server with the KV
// credentials blanked and FAVOUR_MEMORY_STORE=1, so the store is the in-process
// MemoryRedis and nothing this script creates can reach a real record:
//
//   KV_REST_API_URL= KV_REST_API_TOKEN= FAVOUR_MEMORY_STORE=1 npx next dev -p 3011
//   ADMIN_SECRET=$(grep '^ADMIN_SECRET=' .env.local | cut -d= -f2-) \
//     node scripts/o1-first-favour-shots.mjs
//
// MemoryRedis lives for the life of the server process, so a SECOND run needs a
// restarted server: the script refuses to run against a board that already has
// tasks, which is the cheapest signal that the store is not isolated.
//
// ADMIN_SECRET is required: the real one-favour-per-poster-per-day cap in
// api/tasks refuses the second POST without the seed-secret path.

import { chromium } from "playwright";
// NOTE: the app holds an open SSE connection, so "networkidle" never fires.
// Every wait below is on a DOM condition instead.
import { mkdir } from "node:fs/promises";

const BASE = process.env.O1_BASE || "http://localhost:3011";
const OUT = "docs/assets/o1-2026-09-09";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
// Wallet-shaped on purpose: isPublicTask hides dev_/test identities from every
// public surface, so a dev_ poster would create an invisible favour.
const POSTER = "0x01DEM0000000000000000000000000000000B0A9";

async function shot(page, name) {
  // Entrance animations run on mount. Shooting immediately catches the screen
  // mid-fade and every colour reads washed out, which is a lie about the design.
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name);
}

async function cold(browser, viewport) {
  // A fresh context every time: no localStorage, so this is a true stranger.
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function seed(admin, body) {
  const res = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-seed-secret": admin },
    body: JSON.stringify({ poster: POSTER, deadlineHours: 336, rewardType: "points", ...body }),
  }).then((r) => r.json());
  if (!res?.task?.id) throw new Error(`create failed: ${JSON.stringify(res)}`);
  return res.task;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log("ok:", msg);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const admin = process.env.ADMIN_SECRET || "";
  if (!admin) throw new Error("ADMIN_SECRET is required");

  const existing = await fetch(`${BASE}/api/tasks`).then((r) => r.json());
  if ((existing.tasks || []).length > 0) {
    throw new Error(
      `Refusing to run: ${BASE} already has ${existing.tasks.length} tasks, so it is not an isolated in-memory server.`
    );
  }

  const browser = await chromium.launch();

  // --- 1. EMPTY STATE: the board is genuinely empty, and the screen says so ---
  {
    const { ctx, page } = await cold(browser, PHONE);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=No favour is open at this moment.");
    await shot(page, "01-empty-board-390");
    await ctx.close();
  }

  // --- 2. ERROR STATE: the board request fails ---
  {
    const { ctx, page } = await cold(browser, PHONE);
    await page.route("**/api/tasks", (r) => r.fulfill({ status: 500, body: "boom" }));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=We could not load an open favour just now.");
    await shot(page, "02-board-error-390");
    await ctx.close();
  }

  // --- Seed a feedback favour first, then a photo favour that outranks it ---
  // Rank order is the server's (BOARD-RULES R5: non-feedback before feedback).
  // Seeding in this order proves the lead card follows the board, not the code.
  const feedbackTask = await seed(admin, {
    description: "Tell us the one thing FAVOUR should build next",
    location: "Anywhere",
    category: "feedback",
    bountyUsdc: 10,
    maxCompletions: 25,
  });

  // --- 3. LEAD FAVOUR, first seeded state ---
  {
    const { ctx, page } = await cold(browser, PHONE);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`text=${feedbackTask.description}`);
    await shot(page, "03-first-screen-lead-feedback-390");
    const body = await page.innerText("body");
    assert(
      body.includes(feedbackTask.description),
      "first screen renders the description the API returned (data is wired, not hardcoded)"
    );
    assert(body.includes("An answer in your own words"), "text favour asks for a written proof");
    await ctx.close();
  }

  const photoTask = await seed(admin, {
    description: "Photograph the queue outside your nearest museum right now",
    location: "Paris",
    category: "photo",
    bountyUsdc: 15,
    maxCompletions: 5,
  });

  // --- 4. THE LEAD CHANGED because the board changed, not the component ---
  const api = await fetch(`${BASE}/api/tasks`).then((r) => r.json());
  const apiLead = api.tasks.find((t) => t.status === "open");
  assert(apiLead.id === photoTask.id, "the API's first open task is now the photo favour");

  let leadId;
  {
    const { ctx, page } = await cold(browser, PHONE);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`text=${photoTask.description}`);
    await shot(page, "04-first-screen-lead-photo-390");
    const body = await page.innerText("body");
    assert(body.includes(apiLead.description), "the rendered lead equals the API's first open task");
    assert(!body.includes(feedbackTask.description), "the previous lead is gone: the page follows the board");
    assert(body.includes("A photo you take yourself"), "photo favour asks for a photograph");

    // The tokens that actually render, read from computed style. No claiming a
    // typeface the app does not load.
    const tokens = await page.evaluate(() => {
      const h = document.querySelector("h2");
      const cs = getComputedStyle(h);
      return {
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        headingColor: cs.color,
        fontFamily: cs.fontFamily,
        renderedFace: cs.fontFamily.split(",")[0].trim(),
        // fonts.check() is NOT an availability probe: it returns true for a
        // family the page never loads. Real evidence is the FontFace status
        // plus a width measurement against a family that cannot exist.
        faceStatus: [...document.fonts].filter((f) => f.family.includes("Lausanne")).map((f) => `${f.weight}:${f.status}`),
        widthProbe: (() => {
          const m = (fam) => { const el = document.createElement("span"); el.textContent = "Photograph the queue"; el.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-size:40px;font-family:${fam}`; document.body.appendChild(el); const w = Math.round(el.getBoundingClientRect().width * 100) / 100; el.remove(); return w; };
          return { declared: m('"TWK Lausanne"'), appleSystem: m("-apple-system"), nonexistent: m('"No Such Face XYZ"') };
        })(),
        // Computed colours come back in lab() under Tailwind v4, so resolve
        // them to real RGB through a canvas rather than reporting a guess.
        toRgb: (() => {
          const c = document.createElement("canvas").getContext("2d");
          const read = (v) => { c.fillStyle = "#000"; c.fillStyle = v; c.fillRect(0,0,1,1); const d = c.getImageData(0,0,1,1).data; return `#${[d[0],d[1],d[2]].map(n=>n.toString(16).padStart(2,"0")).join("")}`; };
          // Every value here is MEASURED. Tailwind v4 reports lab(), so the
          // canvas resolves it; quoting a remembered v3 hex would be a claim,
          // not a reading. Points amber comes off the rendered RewardBadge and
          // money green off a probe span carrying the same class the funded
          // surfaces use.
          const probe = (cls) => { const el = document.createElement("span"); el.className = cls; el.textContent = "x"; document.body.appendChild(el); const c = read(getComputedStyle(el).color); el.remove(); return c; };
          const amberEl = document.querySelector(".text-amber-600");
          return {
            heading_h2: read(cs.color),
            page_body_bg: read(getComputedStyle(document.body).backgroundColor),
            muted_first_p: read(getComputedStyle(document.querySelector("p")).color),
            points_rewardBadge: amberEl ? read(getComputedStyle(amberEl).color) : "NOT RENDERED",
            money_success600_probe: probe("text-success-600"),
          };
        })(),
      };
    });
    console.log("COMPUTED TOKENS", JSON.stringify(tokens));

    leadId = photoTask.id;

    // --- 5. OPEN THE REQUEST, by clicking the real control ---
    await page.click("text=Open this request");
    await page.waitForURL(`**/f/${leadId}`);
    await page.waitForSelector("text=What counts as done");
    await shot(page, "05-request-opened-390");
    const detail = await page.innerText("body");
    assert(detail.includes(photoTask.description), "the request page shows the seeded description");
    assert(/proof required/i.test(detail), "the request page states the proof requirement");
    assert(detail.includes("checked by AI"), "the request page says what happens to the proof");
    assert(detail.includes("places are still open"), "the request page gives a reason to return");

    // The fulfil section, actually legible. The app's bottom nav is fixed, so a
    // fullPage capture paints it over whatever sits at that scroll offset, and
    // the first run of this script hid the body of "What happens to your proof"
    // behind it. Scroll to the section and shoot the viewport.
    // scrollIntoViewIfNeeded is not enough: the heading counts as "in view"
    // while the fixed nav still paints over the paragraph under it. Put the
    // section in the MIDDLE of the viewport instead.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll("p")].find((n) => n.textContent.trim() === "What happens to your proof");
      el.scrollIntoView({ block: "center" });
    });
    await shot(page, "05b-request-fulfil-390");

    // Full page too, with the fixed nav hidden so nothing is occluded.
    await page.addStyleTag({ content: "nav, [class*='fixed bottom-0'] { display: none !important; }" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/06-request-full-390.png`, fullPage: true });

    // --- 6. THE FULFIL HANDOFF: the CTA reaches the app with the task deep link
    await page.click("text=Do this favour");
    await page.waitForURL(`**/?task=${leadId}`);
    await page.waitForTimeout(2500);
    await shot(page, "07-do-this-favour-handoff-390");
    await ctx.close();
  }

  // --- 6b. THE FULFIL PATH, actually walked ---
  // Outside World App, MiniKit is not installed, so "Continue" mints a browser
  // preview dev_ identity (page.tsx handleVerify, the browser-only branch).
  // That is the only way to reach the submit form without a wallet, and points
  // favours are not tier-gated, so the form is genuinely reachable here.
  {
    const { ctx, page } = await cold(browser, PHONE);
    await page.goto(`${BASE}/?task=${leadId}`, { waitUntil: "domcontentloaded" });
    await page.click("text=Continue");
    await page.waitForTimeout(3500);
    await shot(page, "11-fulfil-form-390");
    const body = await page.innerText("body");
    console.log("fulfil screen mentions the favour:", body.includes(photoTask.description));
    await ctx.close();
  }

  // --- 7. 404: a request id that does not exist ---
  {
    const { ctx, page } = await cold(browser, PHONE);
    const res = await page.goto(`${BASE}/f/does-not-exist`, { waitUntil: "domcontentloaded" });
    assert(res.status() === 404, "an unknown favour id returns 404, not an invented favour");
    await shot(page, "08-request-404-390");
    await ctx.close();
  }

  // --- 8. Desktop ---
  {
    const { ctx, page } = await cold(browser, DESKTOP);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`text=${photoTask.description}`);
    await shot(page, "09-first-screen-1440");
    await page.goto(`${BASE}/f/${leadId}`, { waitUntil: "domcontentloaded" });
    await shot(page, "10-request-opened-1440");
    await ctx.close();
  }

  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
