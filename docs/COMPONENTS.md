# FAVOUR components after 8d56a69 (PR 59) plus PR 60 and the 19 Oct deck (PR 61)

Written 19 Oct 2026, FAVOUR-PAY lane. Source: `find src/app -name page.tsx`, `ls src/components`, BottomNav.tsx. One main design direction: brand variant A (white ground, true black, 2 px rules, square corners, one blue per screen, orange only for FOUND ELSEWHERE). The `.fv` layer in globals.css carries it. Old screens keep the old look until they merge or go.

## Screens

| Route | Component | Verdict | Why |
|---|---|---|---|
| / | fv/Deck, fv/DeckCardView, fv/Loud (PR 61) | STAY | The product: one big card, swipe right to try and review, left to skip. Oscar's projects, posted apps, Show HN (data only, orange banner). |
| /apps | fv/ProjectsHome, fv/ProjectCard, fv/TenHumans | STAY | The same deck as a list ("See the list"). |
| /project/[id] | fv/ProjectView, fv/TenHumans, fv/PaySlots (PR 60) | STAY | One project, its favours, its paid slots, its reviewed work. |
| /project/[id]/feedback | fv/FeedbackForm | STAY | The review. Same form for points and paid slots. |
| /post | PostApp | STAY | Post your app: link, name, ask, points or USDC. |
| AppsToCheck | component | GO | Replaced by fv/ProjectsHome at /apps (PR 61). |
| /board | Feed, DailyFavour, TaskMap, CategoryIcon | GO after paid slots prove out | The old favours board. Its escrow flow is the one PR 60 reuses through /api/escrow-v2, so the route stays; the screen goes. |
| /task/[id] | task page (fund, release, refund for old tasks) | MERGE into /project/[id] | PaySlots does the same three actions per slot in the new look. Keep until no open usdc-v2 task predates PR 60. |
| /history | fv/HistoryScreen (PR 61) | STAY | What I did and earned, plus the latest work on FAVOUR. |
| /dashboard | fv/ProfileScreen, lib/badges (PR 61) | STAY as Profile | Name, picture, badges with levels, streak, own numbers. Operator numbers live in /api/stats. |
| /polls | Polls | GO | Left the tab bar in PR 59. Nobody posts polls. |
| /jury/appeals, JuryMode | jury pages | GO | Jury loop never ran with real strangers. Keep the API dark. |
| /companies/[id]/review, /contributions | CampaignPage, company review | MERGE into /project/[id] | The builder's view of reviews is the owner view of PaySlots plus Reviewed work. |
| /agent/[id] | agent page, Predictions | GO | Agent-posted tasks were an earlier pivot. |
| /terms, /privacy | static | STAY | Updated in PR 60. |
| Onboarding, WorldAppHandoff, fv/SignInSheet | components | STAY (SignInSheet), GO (Onboarding 5 screens) | PR 59 replaced the wall with the one sheet. |
| BottomNav | Deck, Post (centre), History, Profile (PR 61) | STAY | Favours tab dropped; /board by a text link under the deck. |
| LivenessStrip, VerificationBadge, ErrorBoundary, PageTracker | shared | STAY | Plumbing. |
| ui/EmptyState | shared | MERGE into .fv | One empty state style. |

## Main design direction

Variant A, as ruled 19 Oct (NOTES.md of the revamp lane): white ground, true black, one cold blue #0047ff on the number that matters, Aeonik local stack, square 2 px borders, no shadow, no grey hierarchy, no stamps. The device is TEN HUMANS. Every screen that stays gets the `.fv` classes; every screen that goes is deleted, not restyled.

## The deck (PR 61, 19 Oct 2026, Oscar ~18:35 and ~18:45)
Data: lib/deck-view.ts (pure), lib/deck.ts (store), lib/deck-seed.ts (Oscar's projects with a public link), lib/hn.ts (Show HN via Algolia, revalidate 600 s, page pictures cached an hour in memory), lib/funky-art.ts (placeholder art), lib/badges.ts. Route GET /api/deck.
Game feel: streak and today's count in localStorage (lib/deck-view.ts bumpStreak), badges from the person's own contributions, the loud screen (Look C) once per page when a review lands or a streak day begins. Motion: transform only, ease-out, 240 ms, reduced motion respected.
