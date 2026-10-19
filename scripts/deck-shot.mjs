// Screenshots of the deck system at 390 wide, 3x, full page. Usage:
//   node scripts/deck-shot.mjs <outDir> <base> <route> [route...]   e.g. / /post /history
import { chromium } from "playwright";
const [outDir, base, ...routes] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem("favour_role", JSON.stringify("try")); } catch {} });
for (const r of routes) {
  const name = r === "/" ? "deck" : r.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");
  await page.goto(base + r, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/${name}-390.png`, fullPage: true });
  console.log("shot", name);
}
await browser.close();
