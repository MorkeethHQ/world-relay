# AGENTS.md

## Cursor Cloud specific instructions

### Board supply (Lane A)

- Hourly cron: `GET /api/cron/board-supply` (Bearer `CRON_SECRET`) tops the board up to `BOARD_SUPPLY_TARGET` (8) via `src/lib/board-supply.ts`.
- Points-only, `campaignId` `supply:<templateId>`, agent `favoursupply`. Custody stays retired — no escrow mint path here.
- DailyFavour (`/api/daily`) is a **quiz gate**, not board inventory. Do not confuse the two.
- Post-deploy probe (required): unauthenticated cron must return **401** (not 404); authenticated tick should create `supply:` rows; `curl /api/tasks` open/board-visible count should move toward 8.
- Per-user anti-repeat: Redis `supply:done:{wallet}`; Feed filters via `/api/supply/done?address=`. Fail-closed if Redis is down for supply checks.
- Seed caps still apply to `agent:` posters (3 points/day) — supply fills the *board* for the crowd; one wallet can still hit the daily wall (diverted to jury).

### Standard commands

See `package.json` / `README.md`. Lint: `npm run lint`. Tests: `npx vitest run`. Dev: `npm run dev`.

### Custody

`CUSTODY_RETIRED` must stay true. Do not reopen user escrow. See `SECURITY-INVARIANTS.md` and `src/lib/custody.ts`.
