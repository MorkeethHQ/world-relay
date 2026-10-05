# The local review fixture (TEST DATA)

A way to walk the app in a real browser on one machine, with a store that lives
in memory and data that is labelled TEST DATA. It needs no cloud credential, no
model key and no env file of the real app. Stop the two processes and all of it
is gone.

## Start it

Three terminals, from the repo root, with Node 24 on the PATH.

1. The in-memory store:

   npm run fixture:store

2. The app, on http://localhost:3210:

   npm run fixture:app

   This refuses to start if `.env.local` (or any `.env*` file of the real app)
   is in the folder. Next loads those by itself, and the fixture must not see
   the real keys.

3. Seed it, once the app answers:

   npm run fixture:seed

   The seed prints what it wrote and how (through an app endpoint, or directly),
   the sign-in links, and the exact text of the staged polls. It refuses any
   store that is not the fake on 127.0.0.1 and any app that is not on localhost.

For a clean store, stop the store (step 1), start it again, and seed again.

## Walk it

Open http://localhost:3210/__fixture/ . It is served by the fake store, passed
through by the app only in this fixture. A small "Test data · local preview"
pill shows on every screen.

| Link | Who |
|---|---|
| `/__fixture/signout` | Nobody. The signed-out first visit. |
| `/__fixture/signin?as=ana` | TEST Ana, new participant 1 |
| `/__fixture/signin?as=ben` | TEST Ben, new participant 2 |
| `/__fixture/signin?as=rev1` (`rev2`, `rev3`) | Three qualified TEST reviewers |
| `/__fixture/signin?as=company` | Owner of the TEST company campaign |

The wallets are synthetic identifiers written for this fixture. No real
participant's sign-in is used. The session cookie is signed by the fixture's own
made-up secret, which no deployed environment has.

The check is a stand-in and calls no model. It does what the proof note says:

| Type in the note | Result |
|---|---|
| `TEST FLAG` | flagged, goes to human review |
| `TEST FAIL` | not accepted |
| `TEST DOWN` | the check "did not run": nothing is scored |
| anything else | accepted |

A photo file is still needed where a favour asks for a photo. Use a different
photo for each proof: the app's real duplicate-image guard flags a photo it has
already seen on another favour.

### The two-participant walk

1. `/__fixture/signout`. First visit: the Welcome campaign leads, then the TEST
   company campaign, then the demo brand.
2. The 8 Welcome favours are seeded in the state production showed on 5 Oct
   2026: every shared row is held by an earlier person's flagged proof.
3. Sign in as Ana. Open Welcome, do favour 1, and put `TEST FLAG` in the note.
   The screen says it was sent to human review. The main button is Discover
   more favours. There is no Cancel.
4. Sign in as Ben. Favour 1 is still his to do. Do it with a plain note. It is
   accepted and his points are added. Ana's flag did not take it from him.
5. Sign in as Reviewer 1, then 2, then 3. Review favours, then Decide flagged
   proofs. Each reads Ana's proof and decides with a written reason. Two
   accepting it adds Ana's points. Two declining it reopens her own step.
6. A written answer on a plain favour: as Ana, answer "what does the air
   smell like" with `TEST FLAG` in the note. It goes to the same reviewers.
   Signed in as Ben (not qualified), Decide flagged proofs shows a count and
   how to qualify, and no proof.
7. Each reviewer also sees the 8 original Welcome claims held by the earlier
   TEST person. They come LAST in the deck. A reviewer does not have to decide
   them to reach anything else: "Next proof" and "Previous" step through the
   deck ("Proof 2 of 10") without voting. A proof you pass stays in the queue.
   Deciding one settles that claim only.
8. A company piece: as Ana, open the TEST company campaign, join "An honest
   review", attach a photo and put `TEST FLAG` in the note. It is flagged and
   goes to the company review. Each reviewer finds it under Decide flagged
   proofs, stepping past any other proof with "Next proof" (no vote is cast),
   and decides it with a reason. Two accepting adds Ana's 10 points and a
   History row under the company's name. Signed in as the TEST company owner,
   Your campaigns, "Review evidence and decide" shows the piece, the photo and
   the reviewers' reasons. No USDC moves: the pool stays "proposed, not funded".
9. Polls: three open TEST questions with 0 votes, a vote, a new poll, and the
   closed polls behind "Closed polls".

## What is seeded, and how

Printed by the seed script each time. In short: Welcome favours, open favours,
open polls and the company campaign go through the app's own endpoints. Four
things are written directly, because no endpoint can produce them: the held
state of the 8 Welcome rows, two closed polls, a graded record for the three
reviewers, and three finished proofs for the review deck. No vote and no
completion is written for anyone.

## What this is not

It does not show World wallet sign-in, the camera inside World App, a real
model's verdict, or anything on chain. Those need the real app on a phone.

## The fake store and the company review

The company review saves a vote with one inherited Lua script
(`COMMIT_COMPANY_VOTE` in `src/lib/company-appeal.ts`) and opens a review with
another. The fake store repeats both in JavaScript. It does not get to decide
their rules: `src/__tests__/company-review-scripts.real-redis.test.ts` runs the
real Lua on a real Redis and the fake with the same inputs, and compares the
answer and every key left behind (23 cases). It is opt in and needs the
disposable no-network Redis container:

    FAVOUR_REAL_REDIS_TEST=1 npx vitest run --no-file-parallelism src/__tests__/company-review-scripts.real-redis.test.ts

The two real-Redis test files share one container, so run them one after the
other, never at the same time.
