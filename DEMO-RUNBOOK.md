# FAVOUR live demo runbook

This is an operational checklist, not a product-status source. Current priority
comes from the decision log; live counts come from the Obsidian dashboard.
Money, identity, rewards, and board behavior remain governed by
`SECURITY-INVARIANTS.md`, `BOARD-RULES.md`, and `src/lib/reward.ts`.

## Automated browser preflight

The smoke gate exercises onboarding, preview sign-in, all five navigation
routes, horizontal containment, and 44px navigation targets at 320px, 390px,
and 430px.

```bash
# Once per machine
npx playwright install chromium

# Terminal 1 — build the same production mode used by Vercel
NEXT_PUBLIC_WORLD_APP_ID=app_your_registered_id npm run build
npm start

# Terminal 2
npm run demo:smoke
```

Screenshots are written to `/tmp/favour-demo`. To test another deployment:

```bash
DEMO_BASE_URL=https://your-preview.example npm run demo:smoke
```

Do not point the smoke gate at production unless creating a disposable preview
account is intentional; onboarding calls the real identity endpoint.

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
- Do not enable escrow or session enforcement during the presentation.
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
