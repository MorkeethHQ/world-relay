// A 60 s phone walk of the deck system, recorded headless. Usage:
//   node scripts/deck-record.mjs <outDir> <base> <liveProjectId> <taskId>
import { chromium } from "playwright";
const [outDir, base, pid, task] = process.argv.slice(2);
const browser = await chromium.launch();
// Playwright's own video paints at the CSS size, so a 3x phone came out a third
// full. Frames are taken as 3x screenshots at 8 a second instead and joined with
// ffmpeg: every pixel is real. The Next dev overlay is hidden for the walk.
import { mkdirSync } from "node:fs";
const Z = 1;
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(() => { const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}"; document.addEventListener("DOMContentLoaded", () => document.head.appendChild(st)); });
mkdirSync(`${outDir}/frames`, { recursive: true });
let n = 0; let rolling = true;
const roll = (async () => { while (rolling) { const i = String(n++).padStart(5, "0"); try { await page.screenshot({ path: `${outDir}/frames/f${i}.png`, animations: "allow", caret: "hide" }); } catch {} await new Promise((r) => setTimeout(r, 60)); } })();
const wait = (ms) => page.waitForTimeout(ms);
const swipe = async (dir) => {
  const card = page.locator('.fv-deck-card[data-depth="0"]');
  const b = await card.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  const steps = 14; for (let i = 1; i <= steps; i++) { await page.mouse.move(x + (dir * 170 * Z * i) / steps, y - (i * 2), { steps: 1 }); await wait(22); }
  await page.mouse.up(); await wait(900);
};
await page.goto(base + "/", { waitUntil: "networkidle" }); await wait(2500);           // role card
await page.getByRole("button", { name: "I try things" }).click(); await wait(1800);
await swipe(-1); await wait(600);                                                      // skip STRIVE seed twin? no: first card is STRIVE live
await page.getByRole("button", { name: "React Fire" }).click(); await wait(1200);
await swipe(-1); await wait(600);
await swipe(-1); await wait(600);
await swipe(-1); await wait(800);                                                      // reach a Show HN card
await page.mouse.wheel(0, 0); await wait(1500);
await swipe(1); await wait(1200);                                                      // Looks good on HN
await page.goto(base + "/apps", { waitUntil: "networkidle" }); await wait(2200);      // the list
await page.mouse.wheel(0, 500 * Z); await wait(1200);
await page.goto(base + `/project/${pid}`, { waitUntil: "networkidle" }); await wait(2600);
await page.mouse.wheel(0, 600 * Z); await wait(1500);
await page.goto(base + `/project/${pid}/feedback?task=${task}`, { waitUntil: "networkidle" }); await wait(2000);
await page.getByRole("button", { name: "Yes" }).first().click().catch(() => {}); await wait(700);
for (const n of ["Clean"]) await page.getByRole("button", { name: n }).first().click().catch(() => {}); await wait(700);
await page.getByRole("button", { name: "Design 4 of 5" }).click().catch(() => {}); await wait(700);
await page.getByPlaceholder("One line. Who would use it, in your words.").fill("People who run coding agents all day"); await wait(900);
await page.getByPlaceholder("The first thing you did not get.").fill("Where the run card comes from"); await wait(900);
await page.mouse.wheel(0, 400 * Z); await wait(1500);
await page.goto(base + "/post", { waitUntil: "networkidle" }); await wait(2200);
await page.getByPlaceholder("https://").fill("https://striverun.app"); await wait(1500);
await page.goto(base + "/history", { waitUntil: "networkidle" }); await wait(2200);
await page.mouse.wheel(0, 700 * Z); await wait(1500);
await page.goto(base + "/dashboard", { waitUntil: "networkidle" }); await wait(2500);
await page.goto(base + "/", { waitUntil: "networkidle" }); await wait(2500);
await swipe(-1); await wait(1500);
rolling = false; await roll; await ctx.close(); await browser.close(); console.log(`${outDir}/frames`);
