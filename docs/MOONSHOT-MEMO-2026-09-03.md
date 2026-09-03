# Moonshot memo · FAVOUR · 2026-09-03

Loop 0 (research) + Loop 1 (refute) of `/ambitious-plan`. Written from production
counters, a rendered mobile viewport, and external sources opened today. Nothing
below is taken from an earlier plan doc — those are listed at the end as what
this supersedes or keeps.

## GOAL

**FAVOUR becomes the verified-human jury the AI economy pays for — recruited by
a game people already play for free.**

Press-release line: *"Twelve thousand Orb-verified humans, each with a measured
accuracy score, rule on what's real. Anyone — an AI agent, a lab, a survey
buyer, a platform — can buy a verdict. Nobody can buy a bot."*

## Current model (what we believed until today)

FAVOUR.md (Jul 19): *"a daily verified-observation ritual with a marketplace
behind it"* — Predict → Submit → Reveal, the daily prompt as the gate, the
task board behind it, AI proof-verification as the moat.

Half of it landed. The reveal insight was right (489 reveal views against 200
submits — people come for the answer). The *gate* was not where the engagement
went. Measured today: REAL OR NOT, the peer jury, holds **2,868 verdicts against
17,923 feed loads** — against the daily's 200 submits and the marketplace's
788 proofs. The jury out-engages the thing it was bolted onto by an order of
magnitude, and it was starved (28-proof pool, newest Jul 24) by the marketplace
it depended on. We built a marketplace and accidentally shipped the product.

## External evidence

| Source | What it says | Confidence |
|---|---|---|
| Pebblous 2026 market map; Medium (Singhal) | Human data / judgement market **~$5B, growing >50%/yr**. Four firms (Scale, Surge, Mercor, Handshake) hold >75%. Surge pays experts **$50–200 vetted on a trust score**; Mercor **$760M → $2B ARR in six months** (Dec 25 → Jun 26). Frontier work moved from labels to RL environments and human feedback. | High — multiple sources agree on the names and the scale |
| Prolific (Feb 2026); arXiv 2607.00403; Wiley 2024 | Survey panels are drowning in AI respondents. Prolific shipped "bot authenticity checks" Feb 2026. *"A clean survey record no longer guarantees authenticity."* Buyers now ask *"how many human respondents contributed."* | High — vendor + peer-reviewed |
| touch-grass.world (opened today) | TouchGrass has **pivoted from tasks to judgement**: *"When AI is uncertain, ask a real human."* Task types are now *AI answer check, search result review, LP first impression, copy trust signal* at ¥1–30. MCP + REST for agents. 20% fee. | High — read at source. Validates the thesis and is the nearest competitor |
| world.org/blog | World's 2026 bets: **proof-of-human for the agentic web** (AgentKit Jun 24; World ID for Browserbase, Exa, Okta, Vercel), enterprise (Zoom, DocuSign), consumer trust (Tinder, ticketing). Mini Apps are not the headline; personhood-as-infrastructure is. | High |
| App Store / Play (3+ "Real or AI" apps); whichoneisreal.com (8,000 players); sightengine "AI or Not" | "Real or AI" is a **viral genre**. Every instance is anonymous, single-player, on a canned image set, with no stakes and no verified players. | Medium — traction numbers are self-reported |
| Production Redis, today | Feed loads 17,923 · jury verdicts 2,868 · proofs 788 · posts 93 · paid 4. Text proofs pass 42/42; photo proofs flagged 22/50 (44%). Feedback 10.17 completions/task; photo 0.32. Most-completed favour ever paid 0 points. | Measured |
| Jun 7 competitive memo (aged) | World App: 26M users, 2M DAU, Global South, incentive-driven. What succeeds: token claims, financial utility, **skill-based games with rewards (UNO 188M opens)**. What fails: social, creative, effort-without-reward. Dev Rewards need 10K verified humans. | Medium — three months old, directionally right |

## The thesis, stated once

There is a $5B market for human judgement, growing 50% a year, run by four
companies whose entire quality story is an *internal* trust score. None of them
can prove a rater is a unique human. World can. And FAVOUR already has the one
thing World ID alone does not give you: **a jury that is trained and scored.**

The graded Real-or-Not deck — where the answer is known — measures every
judge's accuracy. Today (shipped this afternoon) that score is already the
qualification for the appeal deck, where the answer is *not* known and the
verdict has consequences. That is the whole company in miniature:

**One correction to "provably good," before anyone reads it as one number.**
Accuracy is *per skill*. Today's graded card tests one thing — does this proof
match this spec (`jury.ts`: "judging skill = reading proof specs") — and that
score transfers cleanly to the appeal rung, which asks the same question. It
does **not** transfer to "is this image AI-generated" or "is this AI answer
correct." So every rung of the ladder gets its own graded deck: known-real vs
known-AI images for the real-or-not rung; buyer-supplied gold-standard items for
a buyer's question. A judge carries a score per rung, and a buyer buys the rung
they need. This is what Surge's "trust score" actually is under the hood, and it
is the difference between a moat and a claim.

- **The game** recruits and trains judges for free, and is fun on its own.
- **The score** makes the jury provably good, not just provably human.
- **The appeal deck** is the first *paid-for* verdict: a real proof, a real
  outcome, a quorum of scored humans. Today the buyer is FAVOUR itself. Tomorrow
  the buyer is anyone.

Surge's trust score + World's personhood + a consumer game as the funnel. That
is fundable. It is not "a tool that checks X." It is *who it makes rich*: the
judge with a 91% accuracy score earning from verdicts, and the buyer who can
finally say "n = 400 verified humans, mean accuracy 0.84" on a data sheet.

## Hypotheses (ranked)

1. **The jury is the product.** Falsifiable: if a cold-open-into-the-jury front
   door does not lift D1 return above the current 10%, the game is not a
   retention engine and this memo is wrong. Kill bar: D1 < 12% measured at
   **n ≥ 200 new arrivals** (≈ 15 days at today's ~13/day; the sample, not the
   calendar, closes the test). Cost: one front-door rebuild (Loop 3 slice 1).
2. **Accuracy-scored verdicts are sellable.** Falsifiable: one external buyer
   (an agent developer, a survey researcher, a platform) pays for a batch of
   ≥ 100 verdicts at ≥ $0.05 each within 30 days of the verdict API existing.
   Kill bar: zero paid batches by day 30 with ≥ 5 named prospects contacted.
   Cost: the verdict API (slice 3) + outreach (Oscar).
3. **AgentKit is the demand door.** Falsifiable: with `/api/agent/register`
   accepting an AgentBook-verified agent instead of `ADMIN_SECRET`, ≥ 3
   external agents register and post within 30 days. Kill bar: 0 external
   registrations. Cost: AgentKit integration (slice 4). *Also* it is x402-native,
   which means **the buyer pays per verdict without touching the retired escrow**
   — the custody blocker in ROADMAP.md does not apply to this business.
4. **A standalone "Real or Not" listing outperforms FAVOUR's front door.**
   Falsifiable: a second Mini App Store listing (Games category) sharing the
   backend reaches ≥ 500 verified humans in its first 30 days. Kill bar: < 200.
   Cost: one listing + one cold-open route (slice 2, most of it shared).

## Refute result (Loop 1)

Adversarial pass against each hypothesis, with the strongest counter I can find:

**Against H1 — "you've measured a swipe game, not a product."** 2,868 verdicts
from ~27 active runners is ~100 per person. That could be a small group
grinding a 20-points-a-day cap, not a retention engine. *Response:* partly
fair — `jury_verdict` 11–74/day comes from 15–32 sign-ins/day, so it is a
minority who play hard. But that is what every retention engine looks like at
n=30, and the day it went to zero (Sep 2–3) was the day the deck ran dry, which
is a supply failure, not a demand one. **Survives, with the kill bar attached.**

**Against H2 — "TouchGrass already does this, with 10M humans, MCP, and a 20%
fee."** *Response:* TouchGrass proves the demand and is the nearest competitor.
Their edge is reach; their gap is quality — verdicts are unscored piecework.
FAVOUR's edge is the *graded* jury: a buyer gets accuracy-weighted verdicts and
can set a minimum judge score. That is the Surge trust-score move, and nobody on
World has it. **Survives — but only if the score is exposed to buyers.** If we
sell unscored verdicts we are a smaller TouchGrass.

**Against H2, harder — "$0.05 a verdict is not a company."** Surge pays experts
$50–200 for *expert* judgement. A swipe verdict is not that. *Response:* true,
and the company is the ladder, not the swipe. Tier 1 is the swipe (is this
real?). Tier 2 is the appeal (does this proof meet this spec?). Tier 3 is the
question TouchGrass is already selling (is this AI answer right?). Same jury,
same score, rising price. Today's build is tier 1–2. **Survives as a ladder,
dies as a single price point.**

**Against H3 — "zero agents registered because there is no demand, not
because the door was shut."** *Response:* unfalsified either way today, which
is why H3 has a 30-day kill bar and costs one integration. It is also the only
hypothesis that opens a *payment* path (x402) without the escrow. Cheap to
test, expensive to be wrong about by assumption. **Survives as an experiment.**

**Against H4 — "Oscar ruled 'not a separate app' on Jul 1, and the reasons
(split attention, split traction) still hold."** *Response:* the Jul 1 ruling
was about a *separate product*. This is a second **door** to the same product:
same repo, same Redis, same jury, same proofs. It costs a listing and a route.
What changed since Jul 1: the game is now the measured winner, "Real or AI" is a
proven viral genre with no verified-human entrant, and FAVOUR's own front door
is five screens deep. **Survives, reframed: two listings, one backend.**

**Collision check**

| Idea | Already fired? | Verdict |
|---|---|---|
| Daily gate / Predict → Submit → Reveal | Yes (Jul 19 →) — 200 submits, 489 reveals | Keep as a *feature* of the game (the reveal is right); no longer the front door |
| Points marketplace as the core | Yes, Jun–Sep — 788 proofs, decaying to 0–2/day | Demote to content pipeline for the jury |
| Campaign unlock ($2, Orb-gated) | Yes — 4 payouts ever; $40 pot doorless 26 days until today | Keep running; it is now a live experiment, not a strategy |
| Agent-hires-human pitch | Pitched, never opened (ADMIN_SECRET door) | Not fired. H3 fires it properly |
| Standalone "Daily" app | Ruled out Jul 1, correctly | Superseded by H4 (second listing, not second product) |
| Streaks / streak freeze | Yes — 22 buys all-time | **Dead. Remove.** Oscar's call today: fake gamification |

## BUILD-PLAN (Loop 2) — five slices, riskiest first

> **1. Cold-open into the jury.** `/` renders one real proof full-bleed with
> REAL / NOT and nothing else; onboarding, terms and wallet arrive only when a
> tap needs them (the Jul 19 "gate the acting, not the browsing" rule, finally
> applied). Appeal cards mixed into the deck, marked *"a human call — your vote
> decides."* Streaks and Buy·30 removed from the profile; replaced by **your
> accuracy** (real, graded) and **verdicts that resolved because of you**.
> Done when: a stranger reaches a verdict in ≤ 2 taps from cold load; D1 tracked
> against the 12% kill bar. Size: 3–4 days. Risk: HIGH — this is H1's test.

> **2. Second listing: "Real or Not."** Same repo, a `/play` route with the
> slice-1 screen and none of the marketplace, submitted to the Mini App Store
> under Games. Done when: listing approved and `world_app_deep_link_opened` is
> split by listing. Size: 2 days + review latency. Risk: MED — store review.

> **3. The verdict API.** `POST /api/verdicts` — a buyer submits N items with a
> question and a minimum judge score; qualified judges see them as deck cards;
> the buyer reads back per-item verdicts with the quorum, the split and the
> mean judge accuracy. Judges are paid **points now, USDC via the relayer
> transfer rail when a buyer pays** — the rail that already works, no escrow.
> Done when: one real external batch of ≥ 100 items resolves end-to-end. Size:
> 4–5 days. Risk: HIGH — H2's test; needs Oscar's outreach for the first buyer.
>
> **The money flow, drawn, because "sidesteps the custody blocker" is a claim
> until it is:** buyer → x402 payment on World Chain → **lands in the relayer
> wallet** → relayer pays judges by ERC-20 `transfer` (the rail that has paid
> every unlock so far). Nothing enters the retired escrow contract. But be
> honest about what that is: for the interval between a buyer paying and judges
> being paid, **customer money sits on the hot wallet that also owns the
> proxy** (ROADMAP §blocker). That is pass-through, not escrow — no contract
> holds it, no one but FAVOUR can claim it — and at $5–50 per batch the blast
> radius is the batch. It is still the same key. So: batches are paid out on
> resolution, not held; the relayer never accumulates more than one open batch;
> and **the multisig sequencing in ROADMAP applies the day a batch exceeds
> what Oscar would leave in a hot wallet.** Until then this rail is cleaner
> than the escrow ever was, because there is no contract to upgrade.

> **4. AgentKit door.** `/api/agent/register` accepts an AgentBook-verified
> signer in place of `ADMIN_SECRET`; x402 on `/api/verdicts` so an agent pays
> per batch. Done when: one agent Oscar did not build registers and posts.
> Size: 3 days. Risk: MED — needs Sandbox access (form) and AgentBook mainnet
> behaviour; both unknown until tried.

> **5. Selfie Check as the middle rung.** IDKit-only, World ID 3.0, access by
> email. Sits between `device` and `orb` in `verification-tier.ts` so the $2
> campaign gate and future paid verdicts are not Orb-only. Done when: a
> selfie-verified user clears the campaign unlock. Size: 2–3 days after access.
> Risk: MED — access-gated, MiniKit/IDKit seam unproven.

**Explicitly last, not a slice:** the roadmap doc, the store blurb rewrite, the
rebrand burn-down. They follow the product; they are not the product.

## OPS (Loop 4 — separate lane, Oscar gates)

- **Oscar, today:** complete one favour on your phone (Orb) so the $2 unlock is
  proven live — the only untested link in the money path.
- **Oscar, this week:** Sandbox access form (needed for slice 4 either way);
  Selfie Check access email (slice 5). Both have unknown lead time.
- **Auto-verifies on schedule:** `replenish-board` 18:30 UTC today is the first
  run with the expressive pool; `poll-refresh` 07:15 daily; `football-sync`
  hourly.
- **Watch:** D1 rate (currently 10%), `jury_verdict`/day, appeal resolutions,
  the $40 pot.

## The standalone-app question, answered

**Yes — a "Real or Not" listing in the Games category, cold-open, one screen.**
Built as a second **door**, not a second product. The Jul 1 reasoning
against a separate app — split funding, split attention, two zero-momentum
surfaces — is still right and this memo does not overturn it. What it overturns
is the assumption that the *game* is the side attraction. It is the product,
and it deserves a listing that is only the game: one screen, Games category,
cold-open, no wallet to play, the same jury underneath. FAVOUR keeps the Earn
listing and the marketplace. One codebase, one Redis, one accuracy score, two
front doors. If the Games listing outgrows the Earn one, that is the data
deciding — and it would be the best problem this project has ever had.

## Explicitly NOT doing

| Could do | Why not now |
|---|---|
| Reopen custody / self-funded escrow | The hot wallet still owns the proxy (ROADMAP §blocker). H3's x402 path pays per verdict without it. Sequence unchanged: multisig → source → then funding. |
| Streak mechanics, XP, badges | Oscar's ruling today. 22 streak-freeze buys all-time agrees. |
| A fresh design system | Slice 1 replaces chrome with content; restyling grey cards is the wrong object. |
| ETHOnline entry from FAVOUR | Oscar's ruling: ETHOnline is a new build. This memo is independent of it. |
| More photo errands on the board | 0.32 completions/task; R11 guard test now forbids the shape. |
| More money into the pot | $40 sat doorless for 26 days; door opened today. Read the result first. |

## What this supersedes / keeps

- **Keeps** FAVOUR.md's reveal insight, its "gate the acting not the browsing"
  rule, and its finding that zero apps prove a fact about the world.
- **Supersedes** FAVOUR.md's front door (the daily gate) with the jury.
- **Keeps** ROADMAP.md's custody sequencing blocker as binding.
- **Supersedes** ROADMAP.md's two-lane framing: the verdict business is a
  third lane that does not need the escrow at all.
- **Keeps** the Jul 1 "no separate app" ruling; reframes it as "no separate
  product — a second listing is fine."

## The three decisions that are Oscar's

Per CLAUDE.md the decision-log owns priority. This memo becomes the plan when
he rules, not before.

1. **Slice 1 go/no-go** — the jury becomes the front door of FAVOUR.
2. **The Games listing** — a second Mini App Store entry, same backend.
3. **The first buyer** — someone Oscar contacts (survey researcher, agent
   developer, platform) or an agent arriving through AgentKit. Decides whether
   slice 3 or slice 4 goes first.
