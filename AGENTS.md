# AGENTS.md

Project overview and product rules live in `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`,
`SECURITY-INVARIANTS.md`, and `BOARD-RULES.md`. Read `CLAUDE.md` and `SECURITY-INVARIANTS.md`
before touching any money/identity/reward/board code.

## Cursor Cloud specific instructions

Scope: the primary product is the root Next.js 16 app (`package.json` name `relay-app`).
`mcp-server/`, `sdks/python/`, and `contracts/` are companion packages — Foundry work
lives under `contracts/` when changing FavourEscrowV2.

### Run / lint / test (root app)
- Dev server: `npm run dev` (Next.js + Turbopack on `http://localhost:3000`).
- Lint: `npm run lint`. Many pre-existing lint errors (`@typescript-eslint/no-explicit-any`
  etc.) are baseline — a non-clean lint run is not necessarily your regression.
- Tests: `npx vitest run` (no `npm test` script). Config: `vitest.config.ts`.
- Typecheck: `npx tsc --noEmit`.
- `src/__tests__/e2e-api.test.ts` is opt-in (`E2E_LIVE_API=1` + `ANTHROPIC_API_KEY`).

### Running with no secrets (default cloud state)
- App boots with zero secrets: Redis → in-memory, AI verify → demo mode, XMTP/Blob off.
  Fine for UI smoke; data does not survive restarts.
- Desktop sign-in: "Continue" → throwaway `dev_...` identity (`src/app/page.tsx`).
- GOTCHA: `dev_` / `demo_` / `e2e_` posters are filtered from the public board by
  `isPublicTask()` in `src/lib/task-serializer.ts`. A 201 from `POST /api/tasks` as
  `dev_` will not show on the board — that is by design. `agent_` (the poster prefix of
  `POST /api/agent/tasks`) is public since 2026-09-03; see `docs/AGENT-DOOR.md`.
- GOTCHA: "Redis → in-memory" above is NOT true for tasks: without `KV_REST_API_URL`
  the store persists nothing (`persistTask` no-ops), so a `201` is followed by `404`s.

### Board supply (do not confuse with DailyFavour)
- DailyFavour (`/api/daily`) is a quiz gate, not board inventory.
- Replenisher: `src/lib/board-replenish.ts` + cron `GET /api/cron/replenish-board`
  (Vercel: `30 6,18 * * *`, Bearer `CRON_SECRET`). Points-only official favours.
- Prod smoke: `curl -sS https://world-relay.vercel.app/api/tasks` and count `status===open`
  (target ~8 when healthy).

### Money / escrow (current truth — Jul/Aug 2026)
- **Legacy proxy `0x274C38…9351` stays retired forever.** Never reopen it.
  `CUSTODY_RETIRED` still gates the old enter paths.
- **FavourEscrowV2** is the live money rail: default
  `0x61041dfC405D6CeA57653B8E8BCBDA209214682f` (Permit2-native after the Jul 31 incident).
  Override via `ESCROW_V2_CONTRACT`. Code: `src/lib/escrow-v2.ts`, API `/api/escrow-v2`,
  Foundry: `contracts/src/FavourEscrowV2*.sol`.
- Intake is gated on `ESCROW_V2_ENABLED=1` (prod currently has this on — confirm with
  `curl /api/escrow-v2` → `enabled`). Do not assume money UI is on in every env.
- Campaign unlock USDC (direct relayer ERC-20) is a separate path — see
  `campaign-unlock.ts` / `SECURITY-INVARIANTS.md`.
- Full MiniKit fund→claim→proof→release needs World App + real secrets; desktop cloud
  VM cannot complete the wallet UX alone.

### Retention / ops
- `GET /api/stats/retention` — device cohort D1/D7/DAU (no auth on this route today;
  treat numbers as operational, not public marketing claims without checking).
- Crons: expire-tasks, replenish-board, reconcile-settlements, football-sync, daily-prompt
  — see `vercel.json`.

### Update script
- Cloud startup refresh: `npm install` from repo root (idempotent). Do not put
  `npm run dev`, migrations, or cron triggers in the update script.
