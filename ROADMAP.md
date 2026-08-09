# FAVOUR — Review + Roadmap

**Written 2026-08-08.** Ground truth pulled from: World Dev Portal MCP (`get_team_context`,
`get_app_config`), `git log`, live endpoints, `src/lib/custody.ts`. Anything not probed is
marked `unverified`.

Owner of priority is still the decision-log (see `CLAUDE.md` §Source of truth). This file is
the **sequenced build queue**, not a re-statement of state.

---

## 1. Review — what is actually true today

### Store

| Field | Live listing (`verified`) | Pending listing (`awaiting_review`) |
|---|---|---|
| Name | Relay Favour | **Favour** |
| Blurb | "AI agents deposit USDC for real-world tasks…" | "Real favours. Photo proof. Real USDC" |
| `is_android_only` | `false` | **`true`** |
| Category | Earn | Earn |
| Integration URL | `world-relay.vercel.app` | `world-relay.vercel.app` |

Two findings:

- **The live blurb sells a retired mechanic.** `src/lib/custody.ts:49` is
  `CUSTODY_RETIRED = true`. No agent can deposit USDC into a first-party contract.
  The pending submission *fixes* this — that is the strongest argument for getting it approved.
- **The pending submission narrows the audience.** `is_android_only` flips `false → true`.
  On approval, iOS users lose the listing. Nothing else in the diff explains it.
  **Unruled — Oscar's call.**

### Money

- The paid loop **is closed**. Custody retired 2026-07-28; the escrow-v2 reopen was rolled
  back after INCIDENT 2026-07-31 (`d5d648c`).
- The only real money that moves is a plain ERC-20 `transfer` from the relayer wallet, for
  campaign unlocks (`campaign-unlock.ts`). That is a payout rail, not an escrow.
- Historical record: 37 on-chain tasks, $27.50 paid out (per `custody.ts` comment).

### The blocker under everything

`0x274C38…9351` is a **UUPS proxy** whose `owner()` is the **relayer hot wallet**
(`XMTP_WALLET_KEY`, present in `.env.local` and Vercel). The key that auto-signs every payout
can also replace the escrow logic. Blast radius today is ~$2.

The contract source **no longer exists in git** and the contract is **unverified on the
explorer**.

**This is the sequencing constraint for the entire product.** Self-funding cannot open until
ownership is off the hot wallet. Order is fixed:

1. Move ownership to a cold/multisig wallet
2. Recover or re-verify the source
3. Only then open funding

### Engineering state

| | |
|---|---|
| Branch | `night/2026-08-05` (not `main`) |
| Untracked | 4 files incl. a Foundry broadcast dir |
| Test files | 34 |
| API routes | 59 |
| Live | `/` 200 in 0.13s · `/api/tasks` 200, 211 KB |
| Open PRs | #9 mobile handoff (DRAFT) · #4 points-utility doc (OPEN since Jul 10) |

`/api/tasks` at 211 KB is a regression watch item — it was cut to 163 KB on Jul 5.

---

## 2. The strategic question this review forces

With custody retired, FAVOUR is a **points and proof** app that occasionally pays out of a
campaign pot. The store listing, the roadmap, and the grant story all still assume an escrow.

So the roadmap below has two lanes and they are deliberately **not** equal:

- **Lane A — land what exists.** Get the honest listing approved, prove strangers use the
  points loop. Cheap, fast, answers "does anyone but Oscar want this".
- **Lane B — reopen money properly.** Cold ownership, verified source, new contract. Slow,
  expensive, and pointless if Lane A says nobody shows up.

**Run Lane A to a verdict before spending on Lane B.**

---

## 3. Roadmap — ordered, each slice independently verifiable

Each slice is sized for one `/frame` prompt. `Done-when` is the observable check.

### Lane A — land what exists

**A1. Fix the Android-only flag** — *ruled 2026-08-08: it was a slip. Blocked on one portal click.*
- **Attempted and refused by the API.** While `verification_status = awaiting_review` the
  metadata is frozen: `configure_mini_app` returns `-32004 Only unverified app metadata can
  be edited`, and `submit_app_for_review` returns `-32004 Only unverified apps can be
  submitted`. There is no withdraw/cancel tool in the MCP's 11 tools.
- Do: Oscar cancels the pending submission at developer.world.org (status returns to
  `unverified`) → then `configure_mini_app` `is_android_only: false` → `submit_app_for_review`.
- Cost: resets position in the review queue.
- Done-when: `get_app_config` shows `is_android_only: false` and a fresh `awaiting_review`.
- Owner: Oscar (one click) → Claude Code (MCP)

**A2. Reconcile the store copy against the running code**
- Do: audit every claim in `STORE-SUBMISSION.md` and the pending description against the
  live rails. Any sentence implying escrow/custody either goes or gets qualified.
- Done-when: a probe per sentence, each either backed by a code path or deleted.
- Owner: Claude Code (Helicon doorway is already flagging this class)

**A3. Merge or close the two stale PRs**
- #4 has been open since Jul 10. #9 is a draft mobile-handoff.
- Done-when: `gh pr list` returns zero PRs older than 14 days.
- Owner: Cursor Claude

**A4. Get `/api/tasks` back under 163 KB**
- Do: find what re-inflated the payload since Jul 5 and cut it.
- Done-when: `curl -s -o /dev/null -w '%{size_download}'` < 167000.
- Owner: Cursor Claude

**A5. Stranger test on the points loop**
- Do: run `/stranger` against a cold install — no local state, no insider knowledge.
- Done-when: a person who is not Oscar completes one favour end-to-end and earns points,
  with the transcript captured.
- Owner: Oscar + Claude Code

**A6. Name the retention number and instrument it**
- The board-replenish engine and retention instrumentation already shipped
  (`9282ee5`). What is missing is the single number that decides continue/stop.
- Done-when: one metric, one threshold, one dashboard row, agreed in advance.
- Owner: Claude Code (`/eval`)

### Lane B — reopen money properly *(do not start until A5 returns a verdict)*

**B1. Move proxy ownership off the hot wallet**
- Done-when: `owner()` on `0x274C38…9351` returns a cold/multisig address, read from a
  live RPC call, not from a doc.

**B2. Recover or re-author the escrow source**
- Done-when: the contract verifies on the World Chain explorer against source committed
  in this repo.

**B3. New contract, cold owner, verified before a single user signs**
- This is what `custody.ts` says reversal actually requires. Not a constant flip.
- Done-when: verified on explorer + a guard test asserting the old implementation can
  never take another deposit.

**B4. Only then: user self-funding**

---

## 4. Working with Cursor Claude

Split by what each is good at, and by what would collide.

| | Claude Code (here) | Cursor Claude |
|---|---|---|
| Owns | Dev Portal MCP, store listing, money-path review, `/eval` + `/stranger` gates | In-repo refactors, PR hygiene, payload/perf work, test coverage |
| Slices | A1, A2, A5, A6, all of Lane B | A3, A4 |
| Branch | `night/*` and `store/*` | `cursor/*` (existing convention — PR #9 uses it) |

**Rules to avoid the collision that already bit this repo:**

- One lane per branch. Never two agents on the same branch (see
  `feedback_shared_tree_branching`).
- Cursor Claude does **not** touch money, identity, reward, or verification code. Those
  route through `SECURITY-INVARIANTS.md` and the guard test here.
- Never `git add -A`.
- Cursor Claude opens PRs; Oscar merges. **Never push without Oscar.**

Hand each slice over with `/frame` — objective, context, constraints, done-when, first-step.
A slice without a `Done-when` does not leave this file.

---

## 5. Open rulings — Oscar only

1. ~~**`is_android_only`**~~ — **ruled 2026-08-08: slip.** Now blocked on Oscar cancelling
   the pending submission in the portal so the record unfreezes. See A1.
2. **The hedge app** — **created 2026-08-08** as `Perfect`,
   `app_ba94bb1f4fd9555490cfcff3e40fee4d`, mini-app, cloud verification, under team
   `Morkeeth`. It is a bare shell: category defaulted to `Other`, `integration_url` is
   World's placeholder docs URL, no store metadata, not submitted.
   **Still needed from Oscar: the one-sentence purpose.** Nothing else moves until then.
3. **Lane B trigger** — what result from A5 is good enough to justify starting it?
