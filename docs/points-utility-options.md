# What should FAVOUR points do? — decision doc for Oscar

Status: **decision needed, nothing built.** The post form already hints "points
will mean more soon" — this doc lays out the options so that promise can be
kept deliberately rather than backed into. Do not start building any of this
without a decision here first, and without re-reading `SECURITY-INVARIANTS.md`
(points and USDC must never be conflated, and AI-generated proof must never
earn either).

## Why this matters now

Points currently have no utility beyond leaderboard bragging rights. The
funding-reward change shipped tonight (funders earn points on confirmed
on-chain settlement) makes points a more central part of the loop, and the
in-app copy is already telling users points will matter. That's a promise to
users — if we don't pick a direction, "soon" quietly becomes "never" and the
copy becomes a broken expectation.

## Option A — Redeem points for perks / USDC discounts

**How it works:** Points accumulate from task completions, verified proof,
and now funding. Users spend points against a catalog: fee discounts on
posting a task, a boosted-visibility slot on the board, cosmetic profile
badges, or (higher-risk) a partial USDC credit toward funding their own task.

**Tradeoffs:**
- Straightforward to reason about — points stay a closed-loop currency
  redeemed for in-app value, never converted to cash, so the points/USDC
  conflation risk is contained (SECURITY-INVARIANTS.md's line stays clean as
  long as redemption is one-directional and non-cashable).
- Still needs a redemption ledger with idempotency + a hold/spend flow — a
  new piece of state that can double-spend or race the same way escrow does,
  so it inherits real correctness risk even though it's not on-chain.
- If redemption ever includes anything that touches actual USDC (e.g. "spend
  1000 pts for $1 off your funded amount"), that blurs the invariant and
  needs an explicit exception signed off in SECURITY-INVARIANTS.md, not an
  inline shortcut.

**Smallest shippable slice:** one redemption item, non-monetary — e.g. spend
points for a 24h board-boost on your own posted task. No USDC touches it at
all. Proves the redemption ledger mechanics before anything riskier is on the
table.

**Legal/expectation risk:** Low if strictly non-cash. Rises sharply the moment
any option lets points reduce a real USDC amount — at that point points start
looking like a financial instrument (stored value / rebate), which changes
the regulatory conversation. Keep perks non-monetary for the first slice.

## Option B — Tier / level unlocks

**How it works:** Points (or a derived lifetime score) move users through
tiers (e.g. Bronze/Silver/Gold) that unlock non-monetary privileges: higher
task-posting limits, priority in search/board ranking, access to
higher-bounty campaigns, an early-access flag for new features.

**Tradeoffs:**
- No new financial surface at all — tiers are just gates on existing
  features, so this is the lowest-risk option relative to the money path and
  SECURITY-INVARIANTS.md.
- Directly touches `BOARD-RULES.md` + `src/lib/board-rank.ts` if any tier
  perk affects board visibility or ranking — must go through that owner's
  process (rules + code + guard test together), not an inline tweak.
- Weakest "wow" factor of the three — tiers alone may not feel like points
  "mean more," since nothing changes hands.

**Smallest shippable slice:** a single tier threshold (e.g. "Verified
Contributor" at N points) that unlocks one clearly-scoped perk — most simply,
a profile badge with no board-ranking effect at all, avoiding
`BOARD-RULES.md` entirely for the first cut.

**Legal/expectation risk:** Very low — this is a loyalty/gamification pattern
with no cash-adjacent claims, closest to how most consumer apps already do
tiers.

## Option C — Token pre-registration / allocation

**How it works:** Points earned today are recorded as a claim on a future
token allocation (a "your points = your future airdrop weight" promise),
positioning current point-earners for a token launch later.

**Tradeoffs:**
- Biggest signal to users ("points will mean more soon" reads most literally
  as this), but also the biggest commitment — once communicated, it's very
  hard to walk back without users feeling misled.
- Says nothing about a token launch actually happening, its timeline, or its
  jurisdiction — this is not a "smallest slice" problem, it's a "do we even
  want this obligation" problem to settle before any UI ships.
- Depending on how it's marketed, this can shade into looking like a
  security offering or a promise of future value tied to platform
  participation — the kind of claim that draws regulatory attention even
  without a token existing yet. This needs real legal review before any
  public commitment, not just an engineering read.

**Smallest shippable slice:** none that's actually small — even a "your
points are being recorded for a future allocation" banner is a public
commitment, not a prototype. If this direction is chosen, the first real
step is a legal review, not a feature branch.

**Legal/expectation risk:** High. This is the option most likely to need
outside counsel before any user-facing commitment, regardless of how small
the initial build is.

## Recommendation shape (not a decision — Oscar's call)

If the goal is to make good on "points will mean more soon" quickly and
safely: **A's smallest slice (non-monetary redemption) or B's smallest slice
(one tier, no board effect)** are both shippable without new legal exposure
and without touching the money path. **C is a business/legal decision first,
engineering decision second** — it shouldn't be scoped as a sprint task until
that's settled.
