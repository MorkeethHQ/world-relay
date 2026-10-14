// Run against the local fixture (npm run fixture:store, fixture:app with NEXT_PUBLIC_FAVOUR_JURY_GAME=1, fixture:seed):
//   APP=http://localhost:3210 node scripts/jury-notsaved-check.mjs ben

// UI PATH CHECK (R2d): the first verdict POST answers the server's real "not saved"
// 409 body; the card must come back on top with the note, and a second swipe
// must land for real and move the count. Real browser, local TEST DATA fixture.
import { createRequire } from "node:module";
const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require("playwright");
const A = process.env.APP || "http://localhost:3210";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto(`${A}/__fixture/signin?as=${process.argv[2] || "ben"}`); await p.waitForTimeout(900); await p.goto(A); await p.waitForTimeout(2500);
for (const label of ["I'll try projects", "Let's go", "Skip", "Got it", "Not now"]) { const l = p.getByRole("button", { name: label }).first(); if (await l.count().catch(() => 0)) { await l.click().catch(() => {}); await p.waitForTimeout(400); } }
await p.evaluate(() => { try { localStorage.setItem("favour_jury_intro_seen", "1"); } catch {} });
await p.goto(A); await p.waitForTimeout(2500);
let failed = 0;
await p.route("**/api/jury", async (route) => {
  if (route.request().method() === "POST" && failed === 0) {
    failed++;
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Your verdict was not saved. Try again." }) });
  }
  return route.continue();
});
await p.getByRole("button", { name: /^(Play|Continue|Keep swiping)$/ }).first().click(); await p.waitForTimeout(1500);
const cardText = async () => (await p.locator("p.line-clamp-3").first().innerText().catch(() => "")).trim();
const header = async () => (await p.locator("p.tabular-nums").first().innerText().catch(() => "")).trim();
const first = await cardText(); console.log("card before:", JSON.stringify(first), "header:", await header());
await p.getByRole("button", { name: "Matches" }).click(); await p.waitForTimeout(900);
const note = await p.getByRole("alert").filter({ hasText: "Not saved" }).count();
const back = await cardText();
console.log("after the 409: note shown:", note > 0, "| same card on top:", back === first, JSON.stringify(back), "| header:", await header());
await p.getByRole("button", { name: "Matches" }).click(); await p.waitForTimeout(1500);
const note2 = await p.getByRole("alert").filter({ hasText: "Not saved" }).count();
console.log("after the retry: note gone:", note2 === 0, "| header:", await header(), "| next card:", JSON.stringify(await cardText()));
console.log("RESULT", note > 0 && back === first && note2 === 0 ? "PASS" : "FAIL");
await b.close();
