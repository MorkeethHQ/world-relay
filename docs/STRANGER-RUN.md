# Stranger walk-through transcript

**Who:** A user pasting the URL — incognito browser, no wallet, no account, no prior context.  
**URL:** https://world-relay.vercel.app  
**Date:** 2026-09-02  
**Method:** Clean profile, follow only what the UI shows. No insider knowledge.

---

## Steps and decisions

| # | Screen | What they see | Decision required | Assumes they already know |
|---|--------|---------------|-------------------|---------------------------|
| 1 | Welcome | Logo **FAVOUR**, subtitle about picking a task / proof / points, Favours · Polls · Points chips | **Get started** | That "FAVOUR" is a product category, not just a word |
| 2 | Explainer | "What you can do here" — do favours, vote polls, earn points/USDC, World sign-in | **Next** | What "favours" and "polls" mean in this app |
| 3 | Terms | Ground rules + links to full terms / privacy | **I agree** | That rewards require "verified work" |
| 4 | Sign in | Globe icon, browser copy explains preview mode | **Continue without wallet** | Difference between preview and World App |
| 5 | Success | "You are all set" + preview-mode body copy | **See open favours** | That open favours will be listed next |
| 6 | Feed — coach | "Your first favour in 3 steps" card (pick → Do it → proof) | **Got it** (optional dismiss) | — |
| 7 | Feed — daily | Dark "daily favour" poll (guess/answer/reveal) | Skip or participate | That this is separate from completing a board favour |
| 8 | Feed — hero | "Do a favour. Prove it. Get rewarded." + open/verified counts | Read only | "Verified" meaning |
| 9 | Feed — list | Task cards with description, location, points badge, **Do it** button | **Which favour?** then **Do it** | That "Do it" opens proof flow (claim is implicit) |
| 10 | Proof | Task recap, step checklist, photo/note upload | Write proof + **Submit** | What counts as acceptable proof |
| 11 | Result | Pass / fail panel from AI verification | **Done** / retry | — |

**Empty board path (zero open favours):**

| # | Screen | What they see | Decision | Assumes |
|---|--------|---------------|----------|---------|
| E1 | Empty teach | "This is a favour" + labelled **Example** card + numbered steps | **Post a favour (about 1 min)** | — |
| E2 | Post wizard | Lands on Describe (Quick opinion template pre-selected) | Write description, **Next**, set 1 pt reward, **Post** | Minimum description length |
| E3 | Confirmation | "You're live" | Return to board | — |

---

## Top three friction points (fixed in this launch)

### 1. REAL OR NOT before favours (assumption: they came to play a game)

**Promised:** A favour marketplace.  
**Happened:** After onboarding, a large REAL OR NOT hero appeared above the task list — reads as the main product.  
**Fix:** Hide REAL OR NOT until the first-run coach is dismissed; show a 3-step coach card first.

### 2. Onboarding tagline assumed crypto literacy

**Promised:** Plain explanation.  
**Happened:** "Real tasks. Real people. Verified on-chain." and "Discover favours" gave no actionable next step. Browser users saw "Continue" with no hint that preview works without a wallet.  
**Fix:** Welcome copy explains the pick → do → proof loop; sign-in step says "Continue without wallet"; final CTA is "See open favours" with preview instructions.

### 3. Empty board sent strangers to jury

**Promised:** See what a favour looks like.  
**Happened:** "Board's refilling" + "Judge proofs — earn points now" — assumes they know judging and hides the favour shape.  
**Fix:** Teaching empty state with an example card, numbered steps, and one-tap post (Quick opinion template, ~1 min).

---

## Verdict

**BLOCKERS (before this pass):** Empty board and onboarding did not teach the core loop; REAL OR NOT dominated first visit.  
**After fixes:** A stranger can reach an open favour (or post one from empty) with explicit 3-step guidance. Completion is observable via `/api/stats/loop`.

---

## Loop instrumentation

| Event | When | Where stored |
|-------|------|--------------|
| `loop_arrive` | First board render per device | `events:counts` in Redis |
| `loop_start` | Proof submitted or task claimed | `events:counts` |
| `loop_complete` | AI verification pass → task completed | `events:counts` |

Read counters: `curl -sS https://world-relay.vercel.app/api/stats/loop | jq`
