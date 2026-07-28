# AGENTS.md

Project overview and product rules live in `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`,
`SECURITY-INVARIANTS.md`, and `BOARD-RULES.md`. Read `CLAUDE.md` before touching any
money/identity/reward/board code.

## Cursor Cloud specific instructions

Scope: the primary product is the root Next.js 16 app (`relay-app`). `mcp-server/`,
`sdks/python/`, and `contracts/` are optional companion packages not needed to run or
test the web app.

### Run / lint / test (root app)
- Dev server: `npm run dev` (Next.js + Turbopack on `http://localhost:3000`).
- Lint: `npm run lint`. NOTE: the repo currently has many pre-existing lint
  errors (mostly `@typescript-eslint/no-explicit-any`); a non-clean lint run is the
  existing baseline, not something your change broke.
- Tests: `npx vitest run` (there is no `npm test` script). Config in `vitest.config.ts`.
- `src/__tests__/e2e-api.test.ts` is opt-in and only runs with `E2E_LIVE_API=1`; it
  hits the live Anthropic API and needs `ANTHROPIC_API_KEY`. It is NOT excluded in
  config, so a plain `npx vitest run` will skip it internally but still report green.

### Running with no secrets (default cloud state)
- The app boots and is fully browsable with ZERO secrets. Redis falls back to an
  ephemeral in-memory store, AI verification uses demo mode, and XMTP/Blob/notify are
  disabled. This is enough for UI smoke tests but data does not persist across restarts.
- In a browser (not World App), the sign-in button says "Continue" and signs you in as
  a throwaway `dev_...` identity (the `else` branch of `handleVerify` in `src/app/page.tsx`).
- GOTCHA: tasks posted by a `dev_`/`demo_`/`e2e_`/`agent_` identity are intentionally
  filtered off the public board by `isPublicTask()` in `src/lib/task-serializer.ts`.
  So after creating a task as a demo user, the feed correctly shows "No tasks yet" even
  though `POST /api/tasks` returned 201. This is by design, not a bug — verify creation
  via the network response / success screen, not the board.

### Real end-to-end (money / World ID / XMTP)
- The true task lifecycle (on-chain USDC escrow, World ID verification, XMTP threads)
  requires running inside World App (MiniKit) plus real secrets: `ANTHROPIC_API_KEY`,
  `KV_REST_API_URL`/`KV_REST_API_TOKEN` (Upstash Redis), `NEXT_PUBLIC_WORLD_APP_ID`,
  `DEV_PORTAL_API_KEY`, `WLD_CLIENT_SECRET`, `XMTP_WALLET_KEY`. These cannot be fully
  exercised from a desktop browser in the cloud VM. See `.env.local.example` and the
  env list in `README.md`/`ARCHITECTURE.md`. Never commit real keys.
