# Launch note — first real user

## One sentence to send

> Hey — I built a tiny app called FAVOUR where you pick a quick real-world task, do it, and send photo proof to earn points; would you try one favour end-to-end and tell me where you got stuck?

## URL

https://world-relay.vercel.app

## Exact thing to ask them to do

1. Open the link in a browser (no account needed — tap **Continue without wallet** through onboarding).
2. Dismiss the short "3 steps" coach if it appears.
3. Pick **any open favour** on the board — or tap **Start this favour** on the highlighted easy one.
4. Tap **Start favour**, follow the instructions, submit a photo or written proof.
5. Wait for the pass/fail result on screen.
6. Reply with: which favour they picked, whether it passed, and anything confusing.

**Done when:** their run shows as `loop_complete` incrementing on the counter below.

## How to read the counter

```bash
curl -sS https://world-relay.vercel.app/api/stats/loop | jq '.loop'
```

Example:

```json
{
  "arrive": 812,
  "start": 94,
  "complete": 71,
  "today": { "arrive": 2, "start": 0, "complete": 0 }
}
```

- **arrive** — distinct devices that reached the board (`loop_arrive`)
- **intent** — tapped Start on a favour (`loop_start_intent`) — if arrive ≫ intent, the CTA isn't working
- **start** — favours started via proof submission (`loop_start`)
- **complete** — favours verified and marked done (`loop_complete`)

A stranger completion = **`complete` goes up by 1** after their session (check `today.complete` if they do it same day).

Detailed event log (requires admin): `POST /api/admin/analytics` with `Authorization: Bearer $ADMIN_SECRET` → `events.recent`.
