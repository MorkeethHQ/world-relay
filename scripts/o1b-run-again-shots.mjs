// O1B driver, 2026-09-09: RUN THIS AGAIN, the whole loop in a real Chromium.
//
// requester -> request -> participant proof -> recorded outcome -> second round
// draft -> returning participant, plus the two negatives that make it real:
// a rejected proof never appears rewarded, and a participant who already did
// the round gets no actionable offer.
//
// IT MUST NOT BE POINTED AT PRODUCTION DATA. Start the dev server with blanked
// KV credentials and the isolated store, a LOCAL session secret, and the
// deterministic local verifier:
//
//   KV_REST_API_URL= KV_REST_API_TOKEN= ANTHROPIC_API_KEY= OPENROUTER_API_KEY= \
//   FAVOUR_MEMORY_STORE=1 FAVOUR_LOCAL_PROOF_PASS=1 \
//   SESSION_SECRET=local-o1b-journey npx next dev -p 3012
//
// The model keys are blanked deliberately. With a real key present the route
// calls the live verifier, which costs money and is not deterministic, and the
// isolated verifier is never reached. Blanked, this run makes ZERO paid calls.
//
//   node scripts/o1b-run-again-shots.mjs
//
// The store is in-process MemoryRedis, so no record here can reach production.
// MemoryRedis lives for the life of the server process: a second run needs a
// restarted server, and the script refuses a board that already holds tasks.
//
// SEEDED IDENTITIES, all wallet-shaped, all points, NO funding of any kind.
// No escrow, no USDC, no relayer, no payout. Points only, by campaign policy.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";

const BASE = process.env.O1B_BASE || "http://localhost:3012";
const SECRET = process.env.O1B_SECRET || "local-o1b-journey";
const OUT = "docs/assets/o1b-2026-09-09";
const PHONE = { width: 390, height: 844 };

const REQUESTER = "0xREQ0000000000000000000000000000000000A1".toLowerCase();
const P1_ACCEPTED = "0xA110000000000000000000000000000000000001";
const P2_REJECTED = "0xB220000000000000000000000000000000000002";
const P3_NEWCOMER = "0xC330000000000000000000000000000000000003";
const REJECT_SENTINEL = "[[LOCAL-REJECT]]";

const ASK_R1 = "Open the app on your own phone and name the first moment you stop trusting it.";
const ASK_R2 = "Open the app on your own phone, then name the first moment you stop trusting it AND what you expected instead.";

function token(address) {
  const payload = `${address.toLowerCase()}.${Date.now() + 7 * 24 * 3600_000}`;
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
}

async function contextFor(browser, address) {
  const ctx = await browser.newContext({ viewport: PHONE });
  await ctx.addCookies([{ name: "favour_session", value: token(address), url: BASE, httpOnly: true, sameSite: "Lax" }]);
  await ctx.addInitScript((wallet) => {
    localStorage.setItem("relay_user_id", wallet);
    localStorage.setItem("relay_verification_level", "wallet");
    localStorage.setItem("relay_onboarded", "true");
  }, address);
  return ctx;
}

async function shot(page, name) {
  // The app's bottom nav is FIXED and is part of the real screen. It stays
  // visible in every shot here: a hidden nav cannot prove an unoccluded screen.
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log("ok:", msg);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const existing = await fetch(`${BASE}/api/tasks`).then((r) => r.json());
  if ((existing.tasks || []).length > 0) {
    throw new Error(`Refusing to run: ${BASE} already has ${existing.tasks.length} tasks, so it is not an isolated in-memory server.`);
  }

  const browser = await chromium.launch();
  const ownerCtx = await contextFor(browser, REQUESTER);
  const owner = await ownerCtx.newPage();

  // --- STEP 1: REQUESTER commissions the campaign, through the real form -----
  await owner.goto(`${BASE}/c/new`, { waitUntil: "domcontentloaded" });
  await owner.getByLabel("Campaign name").fill("Weekly trust check");
  await owner.getByLabel("Requester name").fill("Acme Product");
  await owner.getByLabel("What kind of team?").fill("The team building Acme's mobile app");
  await owner.getByLabel("Ask").fill(ASK_R1);
  await owner.getByLabel("What counts as done, one rule per line").fill("Use the current release\nName the exact screen\nSay what you expected");
  await owner.getByLabel("Proof required").fill("One sentence naming the screen and the moment.");
  await owner.getByLabel("Why this repeats").fill("The answer changes after every release.");
  await owner.getByLabel("People per cycle").fill("2");
  await owner.getByLabel("Points each").fill("5");
  await owner.getByLabel("Cycle hours").fill("168");
  await owner.getByLabel("Number of cycles").fill("3");
  await shot(owner, "01-requester-commissions");
  await owner.getByRole("button", { name: "Start campaign" }).click();
  // waitForURL("**/c/**") matches /c/new, which is where we already are, so it
  // returned before the navigation and the campaign id parsed as "new".
  await owner.waitForURL((url) => /\/c\/.+/.test(url.pathname) && !url.pathname.endsWith("/new"));
  const campaignUrl = owner.url();
  const campaignId = campaignUrl.split("/c/")[1];
  console.log("campaign", campaignId);
  await owner.getByText("The next round").waitFor();
  await shot(owner, "02-round1-owner-before-any-work");

  const tasks = await (await owner.request.get(`${BASE}/api/tasks`)).json();
  const taskId = tasks.tasks.find((t) => t.campaignId === campaignId).id;

  // --- STEP 2: PARTICIPANT 1 does the work and is ACCEPTED ------------------
  {
    const ctx = await contextFor(browser, P1_ACCEPTED);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?task=${taskId}`, { waitUntil: "domcontentloaded" });
    await page.getByText(ASK_R1).first().waitFor();
    await shot(page, "03-participant-opens-request");
    await page.getByRole("button", { name: "Do it" }).click();
    await page.getByPlaceholder("Type your feedback here...").fill("The points balance on the profile screen resets to zero for a second after every refresh, and that is the moment I stopped trusting it.");
    await page.getByRole("button", { name: "Submit Response" }).click();
    await page.getByText("VERIFIED", { exact: true }).waitFor({ timeout: 20_000 });
    await shot(page, "04-proof-accepted");
    await ctx.close();
  }

  // --- STEP 3: PARTICIPANT 2 is REJECTED (negative one) ---------------------
  {
    const ctx = await contextFor(browser, P2_REJECTED);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?task=${taskId}`, { waitUntil: "domcontentloaded" });
    await page.getByText(ASK_R1).first().waitFor();
    await page.getByRole("button", { name: "Do it" }).click();
    await page.getByPlaceholder("Type your feedback here...").fill(`${REJECT_SENTINEL} This submission is driven to be rejected so the rejected path can be photographed.`);
    await page.getByRole("button", { name: "Submit Response" }).click();
    await page.waitForTimeout(6000);
    await shot(page, "05-proof-rejected-negative-1");
    const body = await page.innerText("body");
    assert(!/VERIFIED/.test(body), "a rejected proof never shows the VERIFIED state");
    assert(!/\+5 pts|5 pts earned|Points earned/i.test(body), "a rejected proof never shows points earned");
    await ctx.close();
  }

  // --- STEP 4: the RECORDED OUTCOME the requester reads ---------------------
  await owner.goto(campaignUrl, { waitUntil: "domcontentloaded" });
  await owner.getByText("The next round").waitFor();
  await shot(owner, "06-recorded-outcome-owner");
  const round = await (await owner.request.get(`${BASE}/api/campaigns/${campaignId}/round`)).json();
  assert(round.outcome.accepted === 1, `exactly one proof was accepted (got ${round.outcome.accepted})`);
  // The rejected submission is nowhere: not in the accepted count, not in the
  // campaign progress. The API refuses to report a rejection tally at all,
  // because the store does not keep one and a derived number would be a guess.
  assert(round.outcome.rejectedCount === null, "the API reports no rejection tally, because the store keeps none");
  assert(round.outcome.accepted === 1, "two submissions, one accepted: the rejected one is counted nowhere");
  assert(round.isOwner === true, "the requester is recognised as the owner");
  assert(round.draft === null, "no draft exists before the requester makes one");

  // --- STEP 5: RUN THIS AGAIN, the requester drafts round 2 -----------------
  await owner.getByRole("button", { name: "Run this again" }).click();
  await owner.waitForTimeout(400);
  await shot(owner, "07-run-this-again-editor");
  const askBox = owner.locator("textarea").first();
  await askBox.fill(ASK_R2);
  await owner.getByRole("button", { name: "Save as draft" }).click();
  await owner.getByText("Round 2").first().waitFor();
  await shot(owner, "08-round2-draft-saved");
  const ownerBody = await owner.innerText("body");
  assert(/DRAFT/i.test(ownerBody), "the saved round is labelled DRAFT on the requester's screen");

  // Money can never enter a round draft.
  const moneyAttempt = await owner.request.post(`${BASE}/api/campaigns/${campaignId}/round`, {
    data: { ask: ASK_R2, bountyUsdc: 25 },
  });
  assert(moneyAttempt.status() === 400, "a draft carrying a USDC bounty is refused");
  console.log("money refusal:", (await moneyAttempt.json()).error);

  // A stranger may not draft somebody else's round.
  const strangerCtx = await contextFor(browser, P3_NEWCOMER);
  const stranger = await strangerCtx.newPage();
  const forbidden = await stranger.request.post(`${BASE}/api/campaigns/${campaignId}/round`, { data: { ask: ASK_R2 } });
  assert(forbidden.status() === 403, "only the requester may draft the next round");

  // --- STEP 6: PERSIST AND RELOAD, a returning participant genuinely returns -
  await stranger.goto(campaignUrl, { waitUntil: "domcontentloaded" });
  await stranger.getByText("Round 2").first().waitFor();
  await shot(stranger, "09-returning-participant-sees-round2");
  const strangerBody = await stranger.innerText("body");
  assert(/DRAFT/i.test(strangerBody), "the draft is labelled DRAFT for the participant too");
  assert(strangerBody.includes("What changed since the last round"), "the returning participant is shown what changed");
  assert(strangerBody.includes("5 pts"), "the returning participant is shown what the round pays, in points");
  assert(!/\bClaim\b|\bDo it\b/.test(strangerBody.split("The next round")[1] || ""), "a draft round offers no claim action");
  await strangerCtx.close();

  // --- STEP 7: the INELIGIBLE REPEAT participant (negative two) -------------
  {
    const ctx = await contextFor(browser, P1_ACCEPTED);
    const page = await ctx.newPage();
    await page.goto(campaignUrl, { waitUntil: "domcontentloaded" });
    await page.getByText("Round 2").first().waitFor();
    await page.locator("#next-round").scrollIntoViewIfNeeded();
    await shot(page, "10-ineligible-repeat-negative-2");
    const body = await page.innerText("body");
    assert(body.includes("You already did this round"), "the repeat participant is told they already did this round");
    const offerApi = await (await page.request.get(`${BASE}/api/campaigns/${campaignId}/round`)).json();
    assert(offerApi.offer.actionable === false, "the repeat participant's offer is not actionable");
    console.log("repeat offer:", offerApi.offer.reason, "|", offerApi.offer.detail);
    await ctx.close();
  }

  // --- STEP 8: the draft SURVIVES a reload from a cold context --------------
  {
    const ctx = await browser.newContext({ viewport: PHONE });
    const page = await ctx.newPage();
    await page.goto(campaignUrl, { waitUntil: "domcontentloaded" });
    await page.getByText("Round 2").first().waitFor();
    await shot(page, "11-draft-persists-cold-reload");
    const body = await page.innerText("body");
    assert(/DRAFT/i.test(body), "the persisted draft is still DRAFT after a cold reload");
    await ctx.close();
  }

  await ownerCtx.close();
  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
