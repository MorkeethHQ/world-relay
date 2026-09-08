import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const base = process.env.CAMPAIGN_JOURNEY_URL || "http://127.0.0.1:3012";
const secret = process.env.CAMPAIGN_JOURNEY_SECRET || "local-campaign-journey";
const out = new URL("../docs/assets/campaign-loop-2026-09-08/", import.meta.url);
const owner = "0x1111111111111111111111111111111111111111";
const ask = "Try the current release and name the first moment that breaks trust.";

function token(address) {
  const payload = `${address.toLowerCase()}.${Date.now() + 7 * 24 * 3600_000}`;
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${encoded}.${signature}`;
}

function shot(name) {
  return fileURLToPath(new URL(name, out));
}

async function contextFor(browser, address) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await context.addCookies([{ name: "favour_session", value: token(address), url: base, httpOnly: true, sameSite: "Lax" }]);
  await context.addInitScript((wallet) => {
    localStorage.setItem("relay_user_id", wallet);
    localStorage.setItem("relay_verification_level", "wallet");
    localStorage.setItem("relay_onboarded", "true");
  }, address);
  return context;
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ownerContext = await contextFor(browser, owner);
const ownerPage = await ownerContext.newPage();

await ownerPage.goto(`${base}/c/new`, { waitUntil: "networkidle" });
await ownerPage.screenshot({ path: shot("00-create-entry.png"), fullPage: true });
await ownerPage.getByLabel("Campaign name").fill("Weekly release reality check");
await ownerPage.getByLabel("Requester name").fill("Acme Product");
await ownerPage.getByLabel("What kind of team?").fill("The team building Acme's mobile app");
await ownerPage.getByLabel("Ask").fill(ask);
await ownerPage.getByLabel("What counts as done, one rule per line").fill("Use the current release\nName the exact screen\nExplain what you expected");
await ownerPage.getByLabel("Proof required").fill("A screenshot and one sentence explaining the failure.");
await ownerPage.getByLabel("Why this repeats").fill("The answer changes after every release.");
await ownerPage.getByLabel("People per cycle").fill("3");
await ownerPage.getByLabel("Cycle hours").fill("168");
await ownerPage.getByLabel("Number of cycles").fill("3");
await ownerPage.getByRole("button", { name: "Start campaign" }).click();
await ownerPage.waitForURL(/\/c\/weekly-release-reality-check-/);
const campaignUrl = ownerPage.url();
const campaignId = campaignUrl.split("/c/")[1];
await ownerPage.getByText("0 of 3 verified").waitFor();
await ownerPage.screenshot({ path: shot("01-cycle-one-empty.png"), fullPage: true });

const tasksResponse = await ownerPage.request.get(`${base}/api/tasks`);
const tasksBody = await tasksResponse.json();
let taskId = tasksBody.tasks.find((task) => task.campaignId === campaignId).id;

for (let i = 1; i <= 3; i += 1) {
  const participant = `0x${String(i + 1).repeat(40)}`;
  const participantContext = await contextFor(browser, participant);
  const page = await participantContext.newPage();
  await page.goto(`${base}/?task=${taskId}`, { waitUntil: "domcontentloaded" });
  await page.getByText(ask).first().waitFor();
  if (i === 1) await page.screenshot({ path: shot("02-participant-task.png"), fullPage: true });
  await page.getByRole("button", { name: "Do it" }).click();
  await page.getByPlaceholder("Type your feedback here...").fill(`Participant ${i}: the saved answer disappears after refresh on the results screen.`);
  await page.getByRole("button", { name: "Submit Response" }).click();
  await page.getByText("VERIFIED", { exact: true }).waitFor({ timeout: 20_000 });
  if (i === 1) await page.screenshot({ path: shot("03-first-verified.png"), fullPage: true });
  await participantContext.close();

  await ownerPage.goto(campaignUrl, { waitUntil: "networkidle" });
  if (i < 3) {
    await ownerPage.getByText(`${i} of 3 verified`).waitFor();
    await ownerPage.screenshot({ path: shot(`0${i + 3}-cycle-one-${i}-filled.png`), fullPage: true });
  } else {
    await ownerPage.getByText("Cycle 2 of 3").waitFor();
    await ownerPage.getByText("0 of 3 verified").waitFor();
    await ownerPage.screenshot({ path: shot("06-cycle-two-reopened.png"), fullPage: true });
    const refreshed = await (await ownerPage.request.get(`${base}/api/tasks`)).json();
    taskId = refreshed.tasks.find((task) => task.campaignId === campaignId && task.status === "open").id;
  }
}

await ownerPage.getByText("Requester results").waitFor();
await ownerPage.getByText("3 accepted").waitFor();

console.log(JSON.stringify({ campaignId, nextCycleTaskId: taskId, campaignUrl, screenshots: 7 }, null, 2));
await ownerContext.close();
await browser.close();
