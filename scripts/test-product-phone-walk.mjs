#!/usr/bin/env node
// THE PHONE SCRIPT, RUN BY A BROWSER (14 Oct 2026). TEST DATA only, local only.
//
// It taps through scripts/TEST-PRODUCT.md step by step, in a phone-size
// browser, with the same buttons a person taps. Start the test product first
// (sh scripts/test-product.sh), then:
//
//   node scripts/test-product-phone-walk.mjs [--app http://localhost:3220]
//
// Every step prints PASS or FAIL, and a screenshot goes to --shots (default: a
// new folder in the system temp dir). The exit code is the number of FAILs.
import { mkdtempSync, readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const APP = arg("--app", "http://localhost:3220").replace(/\/$/, "");
const SHOTS = arg("--shots", mkdtempSync(join(tmpdir(), "favour-test-product-")));
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(APP)) { console.error(`REFUSED: the app must be on localhost, got ${APP}`); process.exit(2); }
const fx = JSON.parse(readFileSync(join(here, "review-fixture.json"), "utf8"));
const BEN = fx.participants.find((p) => p.key === "ben").address;
const ASK = "FAVOUR TEST, not real: a photo of any cup on your desk, taken from above";
const PHOTO = join(here, "..", "public", "hero", "coffee.jpg");

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
let fails = 0, shot = 0;
const step = async (n, ok, what, detail = "") => {
  if (!ok) fails++;
  await page.screenshot({ path: join(SHOTS, `${String(++shot).padStart(2, "0")}-step-${n}.png`) }).catch(() => {});
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}. ${what}${detail ? `  (${detail})` : ""}`);
  return ok;
};
const signIn = async (who) => { await page.goto(`${APP}/__fixture/signin?as=${who}`); await page.waitForURL(`${APP}/`); await page.waitForTimeout(3500); };
const has = async (loc, ms = 8000) => loc.first().waitFor({ timeout: ms }).then(() => true, () => false);
// Ben's own record needs Ben's own session (14 Oct 2026), signed with the fixture's made-up secret.
const benCookie = () => { const p = `${BEN.toLowerCase()}.${Date.now() + 3600_000}`; return `favour_session=${Buffer.from(p).toString("base64url")}.${createHmac("sha256", fx.sessionSecret).update(p).digest("base64url")}`; };
const reputation = async () => (await (await fetch(`${APP}/api/reputation?address=${BEN}`, { headers: { Cookie: benCookie() } })).json()).totalPointsEarned ?? 0;

console.log(`TEST DATA phone walk, in a browser. App ${APP}. Screenshots: ${SHOTS}\n`);

// 1. Ana posts.
await signIn("ana");
await page.getByText("Ask a one-off favour").click();
await page.locator("#feed-composer").fill(ASK);
await page.getByRole("button", { name: "A photo" }).click();
await page.getByRole("button", { name: "5 pts" }).click();
await page.getByRole("button", { name: "Post", exact: true }).click();
await step(1, await has(page.getByText("Posted · live on the board")), "Ana posts the TEST favour");

// 2. Ben does it: photo, precheck, note, Submit.
await signIn("ben");
await page.getByText("FAVOUR TEST, not real").first().click();
await page.getByRole("button", { name: "Do it" }).click();
await page.locator('input[type="file"]').first().setInputFiles(PHOTO);
await step("2a", await has(page.getByText(/looks good|might work|retake/i), 15000), "Ben adds a photo and the precheck answers", "the fixture's precheck is the app's stub, no model");
await page.getByPlaceholder("Add a line about it (optional)").fill("My cup. TEST FLAG");
await page.getByRole("button", { name: "Submit" }).click();
await step("2b", await has(page.getByRole("button", { name: "Discover more favours" }), 20000), "Ben submits; the check flags it for review", "TEST FLAG in the note");

// 3. Ben writes to Ana.
await signIn("ben");
await page.getByText("FAVOUR TEST, not real").first().click();
const benBox = page.getByPlaceholder("Message...");
if (await has(benBox)) { await benBox.fill("TEST: hi Ana, here is my cup"); await benBox.press("Enter"); }
await page.waitForTimeout(1500);
const saved = await page.evaluate(async (id) => (await (await fetch(`/api/tasks/${id}/messages`)).json()).messages?.map((m) => m.text) ?? [], page.url().split("/task/")[1] ?? (await (await fetch(`${APP}/api/tasks`)).json()).tasks.find((t) => t.description.startsWith(ASK)).id);
await step("3a", saved.includes("TEST: hi Ana, here is my cup"), "Ben sends Ana a message, and it is saved");
// Fixed 14 Oct 2026: the in-app favour screen draws the thread again.
await step("3b", await has(page.getByText("TEST: hi Ana, here is my cup"), 5000), "Ben's own favour screen shows the message");

// 4. Ana opens her favour from her Profile, reads, answers.
const openFromProfile = async () => {
  await page.getByRole("button", { name: "Profile" }).click();
  const row = page.getByRole("link", { name: /FAVOUR TEST, not real/ });
  if (!(await has(row, 25000))) return false;
  await row.first().click();
  await page.waitForURL(/\/task\//, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return /\/task\//.test(page.url());
};
await signIn("ana");
await step("4a", await openFromProfile(), "Ana taps the favour on her Profile and its page opens", page.url());
const taskUrl = page.url();
const pageText = await page.locator("body").innerText();
await step("4s", !/Access Code Required|Device Required|Chainlink/i.test(pageText), "The favour page has no access code, Device Required or Chainlink line");
await page.getByText("XMTP CHAT", { exact: false }).first().click();
await step("4t", await has(page.getByText("TEST: hi Ana, here is my cup")), "Ana sees Ben's message on her favour page");
const anaBox = page.getByPlaceholder("Type a message...");
await anaBox.fill("TEST: thanks Ben, approving now"); await anaBox.press("Enter");
await step("4b", await has(page.getByText("TEST: thanks Ben, approving now")), "Ana answers");

// 4r. Ben reads Ana's answer in the app.
await signIn("ben");
await page.getByText("FAVOUR TEST, not real").first().click();
await step("4r", await has(page.getByText("TEST: thanks Ben, approving now")) && await has(page.getByText("Poster", { exact: true })), "Ben reads Ana's answer on his favour screen, named Poster");

// 4c. Ana approves.
await signIn("ana");
await openFromProfile();
const before = await reputation();
await page.getByRole("button", { name: "Approve" }).click();
let after = before;
for (let i = 0; i < 10 && after === before; i++) { await page.waitForTimeout(1000); after = await reputation(); }
const status = (await (await fetch(`${APP}/api/tasks/${taskUrl.split("/task/")[1]}`)).json()).task?.status;
await step("4c", status === "completed", "Ana approves and the favour is completed", `status=${status}`);
await step("4d", after > before, "Ben's points went up", `${before} to ${after}`);

// 4e. Ben is told, then sees the points on his Profile.
await signIn("ben");
await step("4e", await has(page.getByText("Nice work!")), "Ben is told he completed his first favour", "the Nice work! dialog");
await page.getByRole("button", { name: "Maybe later" }).click().catch(() => {});
await page.getByRole("button", { name: "Profile" }).click();
let profile = "";
for (let i = 0; i < 25 && profile.length < 200; i++) { await page.waitForTimeout(1000); profile = (await page.locator("body").innerText()).replace(/\s+/g, " "); }
await step("4f", /FAVOUR TEST, not[^]{0,120}?5 pts Completed/.test(profile), "Ben's Profile lists the TEST favour: 5 pts, Completed", profile.match(/FAVOUR TEST, not.{0,40}/)?.[0] ?? "no TEST favour row");

// 5. Reviewer 1 is not a party: no messages on the favour page.
await signIn("rev1");
await page.goto(taskUrl); await page.waitForTimeout(3500);
await step(5, !(await page.getByText("TEST: hi Ana", { exact: false }).count()), "Reviewer 1 opens the same page and sees no message");

// 6. Reviewer 1 plays the jury: one swipe, the day count moves.
await page.goto(APP); await page.waitForTimeout(3500);
const dayText = async () => (await page.getByText(/\/ ?10 today/).first().innerText().catch(() => "")).replace(/\s+/g, " ");
const dayBefore = await dayText();
await page.getByRole("button", { name: /^(Play|Continue|Keep swiping)$/ }).first().click();
for (const label of ["Got it", "Let's go", "Start"]) { const b = page.getByRole("button", { name: label }); if (await b.count()) await b.first().click().catch(() => {}); }
const matches = page.getByRole("button", { name: "Matches" });
if (await has(matches)) { await matches.click(); await page.waitForTimeout(1500); }
const header = (await page.locator("p.tabular-nums").first().innerText().catch(() => "")).replace(/\s+/g, " ");
await step(6, /^1\b/.test(header), "Reviewer 1 swipes once and the day count reads 1", `home said "${dayBefore}", deck says "${header}"`);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL`}. Nothing here left this machine.`);
await browser.close();
process.exit(fails);
