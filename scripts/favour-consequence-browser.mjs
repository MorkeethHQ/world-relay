#!/usr/bin/env node
/**
 * Labelled-wallet browser journey against a running local app + memory KV.
 * The UI drives the real claim and verify routes; no browser response is mocked.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const JUDGE = "0x" + "b00b1e".padEnd(40, "0").slice(0, 40);
const POSTER = "0x" + "d".repeat(40);
const description = "Browser consequence journey: name one small detail that makes a place welcoming";
const evidence = "A chair near the entrance lets someone pause without needing to buy anything.";

async function createFavour() {
  const response = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      poster: POSTER,
      description,
      location: "Anywhere",
      category: "feedback",
      bountyUsdc: 10,
      rewardType: "points",
      deadlineHours: 24,
      maxCompletions: 3,
    }),
  });
  const body = await response.json();
  const id = body.task?.id || body.id;
  if (!response.ok || !id) {
    throw new Error(`Could not create browser favour: ${response.status} ${JSON.stringify(body)}`);
  }
  return id;
}

const taskId = await createFavour();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

try {
  await page.addInitScript(({ judge }) => {
    localStorage.setItem("relay_user_id", judge);
    localStorage.setItem("relay_verification_level", "wallet");
    localStorage.setItem("relay_onboarded", "true");
    localStorage.setItem("relay_first_run_coach_dismissed", "true");
    localStorage.setItem("favour_jury_intro_seen", "1");
  }, { judge: JUDGE });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /REAL OR NOT/i }).click();
  await page.getByRole("button", { name: "Do this favour" }).click();
  await page.getByPlaceholder("Type your feedback here...").fill(evidence);
  await page.getByRole("button", { name: "Submit Response" }).click();

  await page.getByText("VERIFIED", { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText("Contribution", { exact: true }).waitFor();
  await page.getByText("Evidence", { exact: true }).waitFor();
  await page.getByText("Verdict", { exact: true }).waitFor();
  await page.getByText("Credit", { exact: true }).waitFor();
  await page.getByText("+10 pts", { exact: false }).waitFor();
  await page.getByText("No other eligible favour is available to you right now", { exact: true }).waitFor();

  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.getByText("Because you helped", { exact: true }).waitFor();
  await page.getByText(evidence, { exact: false }).waitFor();
  await page.getByText("+10 pts credited", { exact: true }).waitFor();

  console.log(JSON.stringify({
    ok: true,
    account: JUDGE,
    taskId,
    observed: [
      "claim",
      "evidence",
      "authoritative pass",
      "10 points credited",
      "honest no-next-favour state",
      "personal contribution history",
    ],
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    account: JUDGE,
    taskId,
    visibleText: (await page.locator("body").innerText().catch(() => "")).slice(0, 2000),
    error: String(error),
  }, null, 2));
  process.exitCode = 2;
} finally {
  await browser.close();
}
