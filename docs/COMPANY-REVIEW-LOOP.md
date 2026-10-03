# Company photo review

A company still saves a private draft, then publishes separately. An unverified
company stays below the favour list, including when that list is empty.

The AI checks submitted work. For a points-only company campaign that chose AI
and jury review, a flagged photo can enter the existing three-judge backstop.
Each judge must have at least 10 graded cards and 60% accuracy. The company owner
and contributor cannot judge it; each distinct qualified judge records one
reason. Two accept votes among three judges clear the proof. No judge reward,
threshold, USDC payout, funded campaign progress or staking rule changes here.

`company-appeal.ts` binds each card to the submission ID, request, owner, reward,
claimant, photo references, note and AI result. It shares the verification lock
with resubmission and the points wallet lock with other point mutations. A Redis
Lua commit checks both lock leases, source snapshots, current qualification and
key types before writing any vote or completion. Final acceptance updates the
completion guard, task capacity, existing points profile and weekly total,
contributor history and company evidence together. Rejection records the reasons
and reopens the task without points. The AI flag remains an AI flag.

Real or not links to the review page. The contributor and owner can reload their
private History, including the reasons. The owner's separate evidence-backed
business decision does not approve work or award points. An inline photo retained
without blob storage is served through an owner-only image route. Public campaign
summaries contain the verdict and vote count, not private notes or judge reasons.

Legacy poster confirmation, dispute and follow-up routes cannot finish company
work outside this path. A contributor can submit revised proof through the normal
verification route. Earlier generic appeals with recorded votes/resolution are
not automatically replayed: they may already have awarded points without a
completion record and need explicit reconciliation. No live data migration is
included. Text-only flags cannot enter the existing photo jury rule.

History's platform points total still covers closed favours, not contributions to
ongoing multi-piece campaigns. The label states that scope; personal accepted
company pieces are shown separately.

## Validation

Run the normal suite with `npm test` and compile with `npx tsc --noEmit` and
`npm run build`. The Redis transaction tests deliberately require a real isolated
local Redis REST transport; they do not emulate Lua rules:

```sh
FAVOUR_LOCAL_REDIS_TEST=1 \
KV_REST_API_URL=http://127.0.0.1:16480 \
KV_REST_API_TOKEN=local-loop-only \
npx vitest run src/lib/company-appeal.redis.test.ts
```

The test refuses non-local URLs. It creates uniquely named fixture tasks,
wallet-shaped identities and explicitly seeded judge qualification. This proves
local role separation and transaction behavior, not World App identity or earned
human qualification. It exercises accept/decline, insufficient and duplicate
judges, owner refusal, changed proof/request, money/AI-only exclusions, corrupted
storage types, concurrent quorum retries and ordinary noncompany confirmation.
