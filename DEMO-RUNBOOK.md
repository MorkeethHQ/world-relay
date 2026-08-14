# FAVOUR live demo runbook

This is an operational checklist, not a product-status source. Current priority
comes from the decision log; live counts come from the Obsidian dashboard.
Money, identity, rewards, and board behavior remain governed by
`SECURITY-INVARIANTS.md`, `BOARD-RULES.md`, and `src/lib/reward.ts`.

## Automated browser preflight

The smoke gate exercises the desktop QR handoff, onboarding, all five
navigation routes, horizontal containment, and 44px navigation targets at
320px, 390px, 430px, and a 740×360 landscape viewport. It rejects missing,
placeholder, or mismatched World App IDs.

```bash
# Once per machine
npx playwright install chromium

# Terminal 1 — load the existing frozen ID without printing it, then build
set -a
source .env.local
set +a
export DEMO_WORLD_APP_ID="$NEXT_PUBLIC_WORLD_APP_ID"
npm run build
npm start

# Terminal 2 — load and verify the same exact registered ID
set -a
source .env.local
set +a
export DEMO_WORLD_APP_ID="$NEXT_PUBLIC_WORLD_APP_ID"
npm run demo:smoke
```

`DEMO_WORLD_APP_ID` is required in the shell that runs the smoke command. Never
substitute a sample ID: the gate compares it with an independently committed
fingerprint of FAVOUR's registered ID, then compares the generated universal
link with the exact value. The gate reads the running app's commit from
`/api/health`; Next embeds that revision automatically at build time, so an
operator cannot type a different SHA into the report. Screenshots and
`summary.json` are written to `/tmp/favour-demo`.

To test another deployment, set `DEMO_WORLD_APP_ID` to FAVOUR's exact
registered app ID, then run:

```bash
DEMO_BASE_URL=https://your-preview.example \
  npm run demo:smoke
```

The gate never signs in or creates a preview identity. It blocks application
API mutations and intercepts telemetry, so a remote run cannot create users,
tasks, rewards, or analytics events.

## Cross-agent evidence

After the gate runs, review `/tmp/favour-demo/summary.json` first. It records:

- exact browser checks and viewport matrix
- pass/fail status and duration per check
- screenshot filename for every successfully captured result
- a fingerprint of the expected app ID (never the ID itself)
- the required tested commit revision
- an explicit reminder that physical World App testing is still outstanding

Claude and Cursor should compare that report with the screenshots before
discussing code changes. A browser pass is not permission to claim that
MiniKit, camera, identity, or settlement passed on a phone.

## Physical World App preflight

MiniKit identity, camera, notification, and transaction behavior only exists
inside World App and must be checked on a real phone.

- Open the registered FAVOUR listing, not a browser tab.
- Sign in and confirm the displayed World username resolves correctly.
- Confirm Favours, Polls, History, Ranks, and Profile all open.
- Confirm the bottom navigation remains visible and inside the screen.
- Confirm the camera chooser opens from proof submission.
- Confirm network, AI verification, and World Chain services are healthy.

## Live demo sequence

1. Open the browser landing page and explain that it is the preview and
   discovery surface.
2. Use **Open in World App** or scan its QR code to hand off to the phone.
3. Sign in with the real World wallet.
4. Browse the live board and select a genuine favour that can actually be
   completed during the demo.
5. Claim it, perform the real-world action, and capture fresh camera proof.
6. Submit the proof and show the real AI verdict.
7. Show the completion in History and the points result in Profile or Ranks.
8. If a real campaign cash unlock is eligible, show it only after the clean gate
   and on-chain settlement have completed.

## Truth and safety rules

- Never seed fake tasks, fake people, fake proof, or simulated payouts.
- AI-generated, stock, or screenshot proof must not earn points or USDC.
- Say `pts` for points and `$ USDC` only for real money.
- Never describe a submitted transaction as paid. Show payment only after
  settlement is confirmed on-chain.
- Do not change escrow, session enforcement, or any rollout flag as part of a
  presentation. The demo uses the deployment's normal security configuration;
  identity-enforcement rollout is a separate reviewed production change.
- If a live dependency fails, show the surfaced error and recovery path. Do not
  replace the result with a fabricated success screen.

## Final go/no-go

Run immediately before the presentation:

```bash
npx tsc --noEmit
npm test
npm run build
```

Then run `npm start` and `npm run demo:smoke` in separate terminals, or point
`DEMO_BASE_URL` at the deployed preview. The demo is a go only if the automated
gate passes and the physical World App preflight succeeds.
