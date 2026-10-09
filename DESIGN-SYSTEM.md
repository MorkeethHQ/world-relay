# FAVOUR design system (rules, not vibes)

Same discipline as BOARD-RULES.md: these are the rules for every surface.
Anything violating them is a bug, not a style choice. Born from Oscar's Jul 5
live review ("how we create, how we write, how we claim needs to be coherent").

## Colour

- **Ink**: gray-900 (chrome gray-950 for immersive headers). Backgrounds: gray-50 page, white cards, border-gray-200.
- **Money = green-600 ONLY.** Never used for anything that is not real escrowed USDC.
- **Points = amber-600 ONLY** (canonical in RewardBadge).
- **Danger/fail = red-600. Under-review = yellow-600.**
- **NO blue. NO purple** in FAVOUR's own parts. The info-* palette is banned from user surfaces.
- **One exception, one door (Oscar, 8 Oct 2026).** The featured product screen (`FeaturedProduct.tsx`)
  may be filled with the product's own colour, and that colour may be blue or purple. The colour must
  pass `productColour()` in `src/lib/product-colour.ts`. That function refuses every saturated colour
  with a hue from 15 to 195 degrees: orange, amber, yellow, lime, green, teal and cyan. Those hues
  read as points or as money. A refused colour gives an ink screen. A gray passes at any hue.
  The fill is one flat colour, never a gradient. Money and the primary button stay on a white sheet.
  No other surface may take a colour from a campaign or a product. Why: on 3 Sep 2026 a points
  campaign was painted green from its own colour and read as money. Guard: `product-colour.test.ts`.
- **Second door, the picture frame only (Oscar, 9 Oct 2026: "Yes").** When an app has no good picture, its
  own colour may sit behind its icon or its first letter, inside the picture frame and nowhere else.
  The colour must pass `productColour()`, so it is never the amber of points or the green of money.
  A refused or missing colour gives the pale hue from the name (`groundOf()` in `content-rules.ts`).
- **A product's picture is not FAVOUR's colour.** A campaign card (`ProductCampaignCard.tsx`) shows the
  product's picture in a window. The parts around it obey every rule in this file.
- **No picture, no launch.** A campaign goes live only when `pictureAllowsLaunch()` is true.
- Live/pulse dots: green-400/500.

## Buttons

- **Primary**: bg-gray-900, white text, rounded-xl (or rounded-full for compact chips). One per screen.
- **Secondary**: white bg, border-gray-200, gray-900 text.
- **Text link**: gray-900, underline, underline-offset-2. Never coloured links.
- Destructive confirm: red-600 text on secondary shape.
- All tap targets >= 44px, active:scale-[0.98].

## Back navigation (one system)

- **Full-page flows** (wizard, campaign, poll create, task detail): back control TOP-LEFT in the header — arrow icon or "Back"/"Cancel" text, always present, always the same corner.
- **Immersive overlays** (Real or Not): X top-left.
- **Long scrolling pages** additionally end with a full-width SECONDARY button ("Back to favours") so the exit is never off-screen.
- The bottom nav never disappears except in immersive overlays.

## Typography

- Page title 18 bold. Card title 15 semibold. Body 14. Caption 12 gray-400.
- Numbers: bold, tabular-nums. Reward amounts only via RewardBadge/rewardAmountLabel.
- UPPERCASE tracking-wide only for tiny chips (CAMPAIGN, REAL OR NOT), never body copy.

## Voice

- Warm, direct, zero hype. No emojis in chrome (campaign icons excepted).
- Every error states what happened and what to do next, verbatim from the server when it knows better.
- Points are "pts", money is "$ USDC", never mixed (reward.ts owns the labels).

## The system (one kit, 8 Oct 2026 night redesign)

Oscar, 8 Oct 2026: "design components are falling to pieces", "we want the apple and world app feeling,
clean good overview, not too much copy". So there is one kit, `src/components/Kit.tsx` with
`Kit.module.css`, and every product surface draws with it. The kit sets sizes in a CSS module
because the World UI kit resets native headings, paragraphs and form controls outside Tailwind's
layers; a Tailwind size on `<h1>` or `mt-*` on `<p>` can silently not apply.

**Type scale** (one family, the app's sans): display 28/800 tracking -0.02em for the page word
("Today"); title 24/800 for a product name on its own screen; heading 20/700 for a screen
heading; name 16/600 for a row; body 15/400 line 1.5; caption 13/400 gray-400. Numbers are
tabular. Nothing is uppercase except a tiny source chip.

**Spacing scale**: 4, 8, 12, 16, 20, 24, 32. The page gutter is 16. A section starts 24 below
the one before. A heading has 8 to its line and 16 to the first thing to tap.

**Radii**: row 0 (rows sit edge to edge with a hairline), picture 16, card 20, sheet 24, button 16,
field 14, pill 999.

**Surfaces**: page #FAFAFA; card white with a 1px hairline `rgb(0 0 0 / 0.07)`, no shadow; a sheet
is a white card that holds the one primary button; ink gray-900. Two dark surfaces only: the
featured product's own colour (one door, above) and the hunt card on the first tab, which is ink.

**Buttons**: one primary, dark, full width, 52 tall, radius 16, 16/600 white text, at most one
per screen and it is the next step. One quiet pill, gray-100, 44 tall, 14/600 ink, for every
other action (Vote, Open, Try again, Post another). Links in text are ink and underlined.
Disabled is 60% opacity, never a new colour.

**Row**: 72 tall, one tap target: a 56 picture or initial, a name, one caption line, one quiet
pill on the right. Hairline between rows, inset to the text.

**Card**: a lead card is the row's big brother: the product's picture across the top at the
share-picture ratio 1.9:1, then name, line, and one pill. Only the lead card may carry the
dark pill.

**Field**: 52 tall, radius 14, 16 text (so the phone does not zoom), hairline border, ink
focus ring. A label is caption size above it. A counter is a caption under it.

**States**: one pattern, `Note`, for loading ("Reading…"), empty (one line that says what to do
next) and error (one line, then "Try again" as a quiet pill). Nothing spins.

**Width**: phone first at 390. Every screen is one column, `max-w-lg` (512), centred, the same
as the bottom nav, so a laptop shows one phone-wide column in the middle.

**Motion**: a press scales to 0.98. The sheet on the first tab slides up once, 280 ms ease-out, as a
CSS transition, and not at all under reduced motion. Nothing else moves.

## Screens (what each one becomes)

| Screen | Becomes |
|---|---|
| First tab, "Today" (`/`, `HuntLive`, the feed since 9 Oct 2026) | The hunt card on top, then the main feed as project cards (Oscar, 9 Oct 2026: "The feed needs to be crystal clear, favours to projects, review, fetch from hacker news, smart contracts there"; his pick from `feed-directions.html`: "Project cards A for sure"; "only black though"). The bar: the word FAVOUR, and the person's points in ink on gray only when signed in and known. The hunt card, ink, exactly as before: "Today's hunt", three stamp slots that fill with the app's own picture, one status line, and "Day N in a row" only when the server gave 2 or more. Under it, "Projects": one card per app from `/api/feed` in the order `lib/feed.ts` gives (funded favours, then points favours, then the rest in rail order). A card, drawn with World's kit: the wide cover picture (`TalkPicture` cover, gray fallback, no app colour; no cover at all when the server gave no picture, so the card is shorter), a row with the small square picture, the name on one line and the source chip ("Posted by its maker", "Hacker News · N" with the source's own score, "Vote list"), the maker's ask in two lines with the reward at its end (written by `reward.ts` only; USDC only when the task is real money by the existing rule), the 6px review bar with `progressLine` (the bar only when the campaign holds a target), one quiet contract line with a chevron ("N USDC in escrow" only for a v2 task whose stored fund tx has the verified shape, "Points only" for a points favour, nothing for an app with no favour), and one action: "Review · N pts" to `/p/<id>`, "Vote" (the existing vote call, which stamps the hunt), or "Talk" to `/talk/<id>` for a launch. The contract line opens a kit `Drawer`: one sentence, the escrow address shortened, "View on explorer" to worldscan; for points it says FAVOUR pays after the check and no contract holds money. Black, white and gray only on this tab, the reward text and the bar's points included: no amber and no green here (amber is used for nothing but points; it does not follow that points must be amber). One quiet button, "Post your own app", at the end. Empty: one designed card, "Your app here", and the door. The rail and the sheet stay in the code, unmounted and unopened |
| The sheet (inside `Hunt.tsx`, unreachable since 9 Oct 2026: the cards replaced the rail, and a card opens `/p/<id>` directly) | One tap on a tile slides it up: picture, name, one line, where it is from ("From Hacker News · 52 points" for an outside launch, the host otherwise). "Vote" as a quiet pill, only for an app that can take a vote. The dark button is the next step: "Review · N pts" to `/p/<id>` for a product on FAVOUR, "Open" in a new tab for the rest. It closes by the grab handle, a tap outside and Escape. One slow ease-out slide is the only movement; reduced motion gets none |
| Favours tab (`/favours`, `FavoursBoard.tsx` since 10 Oct 2026) | Redrawn after Oscar saw it live on 10 Oct 2026: "favour page is completly undesigned not good", and "we should have like a loading state a fill up, we can gamify favour SO MUCH! it's the new product hunt, i love it". A skin on the old board (`Feed.tsx`, kept in the code, unmounted): the same reads and the same ranking calls from `board-rank.ts` in the same order, nothing sorted or filtered in the component, and the same three steps, exported from `Feed.tsx` and not rewritten: `SubmitProof` to do a favour, `FeedComposer` and `QuickPost` to ask one. Drawn with World's kit on a white page like Talk and the Hall, one gutter of 16, black, white and gray. Header "Favours" at display size on the left, nothing on the right. Loading is a track that fills while the board is read (a CSS transition on width, 1.6 s, none under reduced motion) with three still slots under it; nothing spins. Then the ink banner, as the Hall's totals: white numbers, gray labels, "open" from `/api/tasks`, and for a signed-in wallet "done today" and "pts today" from `/api/me/contributions` (the count and the sum of the points the server paid, today UTC; a zero drawn as a zero). Then today's mission (`pickDailyMission`) as the hero, a white card with a hairline: the ask large, who asked (an agent's label, a username, or "A person", never an address) with the reward at the line's end through `reward.ts`, and the screen's one dark button, "Start", which opens `SubmitProof`; done, it shows a full bar and the points the server paid. Then the Welcome card when `/api/welcome` gave steps: the next step's text, a bar of steps done of total, and "Open", which does what the old board does (POST `/api/welcome/start`, then `SubmitProof` on the person's own instance; the server's own words on refusal). It is the dark button only when there is no mission. Then the company campaign that may lead (`pickCampaignToDo`) as a row ("N pieces open · R pts a piece · Checked"); a tap opens `SubmitProof` on its first open piece. Then "Review favours" (`reviewEntryFor`), with a bar of graded calls of the ten that qualify a reviewer, drawn only when `/api/jury/record` gave a record; its button opens the existing deck (`JuryMode`). Then the heading "Open favours" with the count, and the rows: a category mark, the ask on two lines, who asked, "Open a while" from `isStale`, a bar of accepted replies of the target only when the favour takes more than one reply, and the reward at the right: ink for points, green for funded USDC only, gray with "Not funded" or "Funds on accept" for USDC with no deposit. A tap opens `SubmitProof`; a person's own open favour opens `/task/<id>` instead. Then the campaigns that may not lead, under "More company campaigns" (R16: demoted, never dropped). Then two quiet pills: "Ask a one-off favour", which opens `FeedComposer` in place (its "At a specific place, or for USDC" opens `QuickPost`; the paid wizard `PostTask` stays inside `Feed.tsx` and is not offered), and "Post your own app" to `/post`; then the footer line. Every bar fills once to its value when it mounts, and the board is read again when a step closes, so a favour just done is seen to land. Empty: the banner with zeros, one card with the heading "No open favour today", one line, and the dark "Post your own app". Error: one line and "Try again" |
| Product screen `/p/<id>` | Back chevron, picture, title, line, maker caption, then a card with the ask, then one line with the points and the accepted count, then the primary button. "Open site" is a quiet pill |
| Review write step | Heading "Your review", one line, the site pill, one field, the word count, the primary button |
| Review results | One heading each: "Accepted" with the points large; "Not accepted" with the reason and "Change my review"; "Held" with the reason. One primary each, no second text |
| Post, step 1 | Heading "Post your own app", one line, one field, primary "Show my app". Under the field, an empty lead card frame that says where the app will appear |
| Post, step 2 | The maker's app as the real lead card it will be on FAVOUR (same `LeadCard`), with the name editable under it, the picture link only when the page has none, the ask, the reward line, primary "Post for reviews" |
| Post, step 3 | The same card with the pill "On FAVOUR", primary "See it on the first page", quiet "Post another" |
| History (`/history`, the Hall, 9 Oct 2026) | A leaderboard of apps (Oscar: "get like a new product hunt early tools vibe", "i like the hall, but to keep the banner from Days with usdc, pts and reached out, only black though"). `Hall.tsx`, drawn with World's kit like Talk, not `Kit.tsx`. Header "History" (the tab keeps its name). The banner first: three cells, "USDC paid", "pts", "people reached", from `/api/stats` and drawn only when the server gave all three (else one quiet line); every number and label in ink and gray, no green and no amber here, points and USDC in separate cells. A two-part switch, "Top" and "New"; its chosen half is the one dark element on the screen. Top: the first three as picture tiles on a podium, the first raised, each with its rank mark, name and "N votes"; an open place is a designed slot that says "Open". Rank 4 and on as rows: rank, small picture, name, "N votes". The order is `lib/hall.ts`: votes, then accepted reviews, then the name. An app whose vote count the server did not give has no rank and is never read as zero; it sits under the ranked rows with no number, under "No vote counted yet". Today only a vote candidate can carry a count. No count anywhere: every app is a shelf of pictures, one line, one quiet button to Today's hunt. New: newest first, posted date for a product, the launch list's own order, then the candidates. A tap on any app opens `/p/<id>`, which serves all three kinds. The fallback tile is gray (no app colour reaches the frame here) and every chip is gray. No "this week" and no "maker of the week": votes carry no date and no maker read exists. A person's own results stay on Profile. The prediction archive is one quiet row at the end |
| Profile | One identity block (picture, name, sign-in level). `HunterCard`. Activity rows. Invite as a row. No level name, no rank, no streak flame (`ProofOfFavourCard` is not mounted here) |
| Polls (`/polls`) | Off the nav since 9 Oct 2026 (Oscar: "polls was never good", "WIPE it off"). The page and its data stay, reached from one quiet row at the end of History, because the prediction archive holds existing stakes. Nothing is deleted |
| Tab header (every tab) | The same block in the same place on all five tabs: the tab's word at display size on the left, at most one small thing on the right (points in ink on gray on Today since 9 Oct 2026, a count elsewhere). No white bar, no second line. The tab's word equals its label in the bottom nav |
| Project page (`/p/<id>`, 9 Oct 2026) | One full screen for any app in the rail: posted on FAVOUR, a vote candidate, or an outside launch. Back chevron, the picture wide, the name, one line, where it is from as a caption. Then the feedback round card when the app is on FAVOUR. Then one primary: "Review · N pts", "Vote" or "Open". A vote count is drawn only when the server gave one. The sheet on Today opens it from the picture and the name |
| Feedback round (a card on the project page) | The maker's ask and what came back. Heading "Feedback round". The ask in the maker's words. One line of progress: "N reviews in" (only a review with verdict pass counts; "30+" when the list is full; "N of M" only when the campaign itself holds a target). Then the accepted reviews as plain rows, newest first, as far as the public results list gives them. Empty: "No review in yet. Be the first." No new reward, no new money field |
| Talk (`/talk`, replaces Polls in the nav, 9 Oct 2026) | Rooms (Oscar: "Favour should go for rooms thats best"; the parts he picked from `talk-parts.html`: 1A and 1C, 2B and 2C). Drawn with World's own UI kit, not `Kit.tsx`: white page, the kit's `TopBar` and `Chip`. The first room, the one with the most recent message (the first in rail order when none has one), is a big card with the app's cover picture on top, the name and the last line. Every other room is a row with the wide thumbnail (84 by 56; a 48 square under 360 px), the name, the faces of the last few distinct people who wrote (the kit's `Marble`, a round initial when World gave no picture) and "N people" only when the store gave the count. A room with no message shows no faces and no count. Nothing says who is present now. The picture chain is `content-rules.ts`; the app's colour sits inside the frame only. Never an empty list: every app in the rail has a room |
| A room (`/talk/<id>`) | Back, the app's name, the same small picture at the right, a tap on it opens `/p/<id>`. The dark pinned card (3B) appears only when funds exist (Oscar: "pinned ones should have funds for sure"): for an app posted on FAVOUR it is the maker's own ask from `/api/project/<id>` with its real points, and "Review · N pts" (amber beside pts only) goes to the existing review flow on `/p/<id>`. A free ask typed in a room is a normal line with "I can": one taker, it pays nothing. Messages are flat lines (4C): a round `Marble` or initial, the username at 500 (never a wallet address), a short time, the text under, a hairline between. An agent (5B) is an outlined square mark, its name and the word "agent", its text in an outlined box. The composer (7B): a plus that opens a sheet with "Ask a favour" only, one field, "Send". Every message has "Report", through a `Drawer`. A hidden message is not served. Empty: one line and the composer. Signed out: read only, and the composer says to open FAVOUR in World App. No survey in this phase |
| Onboarding | The same five steps with product words and less text. Buttons stay the UI kit's (sign-in is not touched) |
| Old company-campaign screens | Untouched this run. Reached only from a row when a campaign is open |

## Build plan (ordered, each with its done check)

1. Kit: `Kit.tsx` and `Kit.module.css`. Done when: the guard test reads the kit as a product surface and is green.
2. First page: `Feed.tsx` header, stage, coach cards, counts, empty board; `TaskCard` button. Done when: at 390 the page shows one dark button, one row style, no sentence above a tap target; screenshot read.
3. `TopProducts` on the kit, lead card as `LeadCard`, picture fallback on error, a vote candidate already on FAVOUR is not listed twice. Done when: filled and empty screenshots read; tests green.
4. `/post` as the lead-card flow. Done when: the three steps are seen at 390 with a stand-in read; the guard is green.
5. `/p/<id>` on the kit, all three results. Done when: the five states are seen at 390.
6. Profile. Done when: no level name, no gradient, no keyframe on the page; seen signed in and out.
7. History and Polls headers. Done when: seen at 390 and 1440.
8. Onboarding copy. Done when: a stranger's first five screens are seen at 390.
9. Hostile review, fixes, push.

## Components (strict, Oscar 8 Oct 2026: "We need strict rules on design, compeontsn and how flow swork")

One job, one component. A screen that shows a product uses one of these and nothing else.
A new kind of card needs a new row in this table in the same PR, or it does not merge.
Guard: `design-components.guard.test.ts` reads this table.

| Component | Its one job | It must never |
|---|---|---|
| `Hunt.tsx` | The first tab, in one piece: the bar, the hunt card with three stamp slots and one status line, the feed of project cards (`ProjectFeed`), the door "Post your own app", and the sheet (kept, unopened since 9 Oct 2026) | Draw a stamp the server did not give. Show a streak under 2, or one for a signed-out person. Copy a number from a mock. Show a count the server did not give. Use a second dark button. Colour the points amber. Move anything but the sheet's one slide |
| `HuntLive.tsx` | `Hunt` with its data from `/api/feed`, `/api/votes`, `/api/hunt` and the person's own contribution record, and its loading and error states. The one line the first tab mounts | Draw a tile or a card itself. Show points to a person the server does not know. Treat a failed read of the card as an empty card with a number on it. Read "mine" from anywhere but `/api/votes` |
| `ProjectFeed.tsx` | The main feed on Today: the cards from `/api/feed` in the server's order, the empty card, the vote problem line, and the contract `Drawer` (one sentence, the address shortened, "View on explorer") | Reorder the cards. Draw a card the server did not give. Name an address the card does not carry. Use `Kit.tsx`. Use amber or green |
| `ProjectCard.tsx` | One project in the feed: the cover (none when there is no picture), the small picture, the name, the source chip, the ask with the reward at its end, the 6px review bar with its label, the quiet contract line, and the one action | Write a reward (reward.ts writes it, through `lib/feed.ts`). Draw a bar with no target. Draw a count the server did not give. Name a contract for an app with no favour. Pass an app's colour to a picture frame. Use amber or green, the reward text included. Use `Kit.tsx` |
| `TopProducts.tsx` | The list form of the same apps, on `/look` only since the hunt: the heading "Today", one lead card, one kind of row, and the door "Post your own app" | Mix FAVOUR's numbers with an outside source's numbers. Show a proposed pool as money. List a campaign that names no product. Show a count the server did not give. Use a second dark button. Explain an empty group with a sentence |
| `ProductCampaignCard.tsx` | One product in a list: its picture in a window, its name, one line, one button | Show green for a budget that is not funded. Use a picture from another product |
| `FeaturedProduct.tsx` | One product fills the screen. Used for one product at a time | Take a colour except through `productColour()`. Use a gradient. Move |
| `HunterCard.tsx` | The top of the profile: products reviewed, reviews accepted, products launched | Show a level, a rank or a badge with no rule behind it. Show a GitHub name that is not verified |
| `TopProductsLive.tsx` | `TopProducts` with its data from `/api/top`, and its loading and error states. Mounted on `/look` | Draw a product row itself. Choose a link for the server to read |
| `ProductScreen.tsx` | Flow 1 on one route, `/p/<id>`: the product, the review, the result of the check | Show a result the check did not give. Name money. Call a held review accepted or refused |
| `HunterCardLive.tsx` | `HunterCard` with the signed-in person's own data, at the top of the profile page | Ask for another person's record. Show zeros to a person who is not signed in |
| `PostYourApp.tsx` | Flow 2 on one route, `/post`: paste the link, confirm what was read, write the ask, post | Publish what the maker did not see. Name money. Publish with no picture. Trust a picture link the server did not read, except the maker's own |
| `RewardBadge.tsx` | Every reward amount, points or USDC | Be replaced by a hand-written amount |
| `TalkRooms.tsx` | Talk, the list of rooms from `/api/talk`: one lead card, then one row per room, with its loading, empty and error states | Draw a count or a face the server did not give. Say who is present now. Sort by anything but the last message. Use `Kit.tsx` |
| `TalkRoom.tsx` | One room from `/api/talk/<id>`: the maker's ask as the dark card only when `/api/project/<id>` gave an ask, points above zero and a review the app takes now, flat message lines, the agent mark, the composer with its plus sheet, Report through a sheet | Print a reward the server did not give. Pin a free ask as the dark card. Let an agent say "I can". Read sign-in from local storage. Name a wallet address. Show a Poll or Survey choice |
| `TalkPicture.tsx` | An app's small picture in one of four shapes, square, wide, cover and tile (a full-width square, for the Hall's podium), walking the chain in `content-rules.ts` | Put the app's colour anywhere but inside its own frame. Pass a colour that `productColour()` refuses. Change size with the picture's quality |
| `Hall.tsx` | History, the leaderboard: the totals banner from `/api/stats`, the Top and New switch, the podium, the rows, the unranked shelf, with its loading, empty and error states. Order from `lib/hall.ts`, apps from `/api/top` and `/api/votes` | Rank an app whose count the server did not give, or read null as zero. Draw a total the server did not give. Colour the banner green or amber. Pass an app's colour to a picture frame. Show a week, a date or a maker the store does not hold. Use `Kit.tsx` |
| `TalkFace.tsx` | Who wrote: a person as the kit's `Marble` or a round initial, an agent as an outlined square mark | Draw an agent as a Marble. Show a wallet address |
| `Kit.tsx` | The one kit: `Screen`, `TopBar`, `Heading`, `Button`, `Pill`, `Row`, `LeadCard`, `Picture`, `Field`, `Note`, `Counts`. Every product surface draws with it | Hold a colour that means points or money. Hold a keyframe. Know about a product, a route or a reward |
| `FavoursBoard.tsx` | The Favours tab, in one piece: the header, the fill-up loader, the ink banner (open, done today, pts today), today's mission as the hero with the one dark button, the Welcome card, the company campaign, "Review favours" with the existing deck, the open favours as rows with their rewards and target bars, the demoted campaigns, "Ask a one-off favour" with the old board's composer, the door to `/post`, with its loading, empty and error states. Data from `/api/tasks`, `/api/me/contributions`, `/api/welcome`, `/api/campaigns/company`, `/api/jury/record` and `/api/jury`; order from `board-rank.ts`; the steps are Feed's own `SubmitProof`, `QuickPost` and `FeedComposer`, mounted as Feed mounts them | Sort or filter a favour by a rule of its own. Write a reward (reward.ts writes it). Colour an unfunded USDC favour green. Use amber. Draw a bar with no real fraction behind it. Draw a count, a rank or a streak the server did not give. Name a wallet address. Rewrite a step that Feed already has. Show a second dark button. Use `Kit.tsx`. Spin |

Rules for every component in the table:

1. **Four states exist:** empty, loading, error and filled. An empty state says what to do next.
2. **A number carries its source or its time.** "63 points" names whose points. "0 reviews" says "today".
3. **Real data only.** A zero is shown as a zero. An example is shown only on `/look` and says "example".
4. **Phone first.** It is designed at 390 px. A row is at least 72 px tall and is one tap target.
5. **Text is short.** One heading, one line under it. No paragraph above the first thing a person can tap.
6. **Nothing pulses, bounces or blinks.** Three slow movements are allowed: the capture inside `ProductCampaignCard` (a keyframe), the sheet's one slide up in `Hunt` (a transition, 280 ms ease-out, none under reduced motion), and the fill-up on the Favours tab in `FavoursBoard` (Oscar, 10 Oct 2026: "a loading state a fill up", "we can gamify favour SO MUCH"): the loader's track fills once while the board is read (a transition on width, 1.6 s ease-out), and every bar with a real fraction behind it fills once to its value when it mounts (700 ms ease-out), so a favour just done is seen to land when the board is read again. None under reduced motion.
7. **The words come from the product.** FAVOUR does not write a product's name or line for a maker.

## Flows (strict)

A person who opens FAVOUR does one of two things. Every screen serves one of the two.

**Flow 1: review a product and get paid.**

1. First tab: the hunt and the feed. Tap "Review · N pts" on the product's card.
2. Product screen: the picture, what the maker asks, the reward. One primary button.
3. The person tries the product and writes the review.
4. The check runs. Passed: the reward is shown at once, and the product is a stamp on today's hunt card. Not passed: the reason is shown, with what to change.

**Flow 0: check an app and collect a stamp.** (8 Oct 2026, night; the cards since 9 Oct 2026)

1. First tab: the hunt card and the feed of project cards.
2. "Vote" on a candidate's card, or "Review · N pts" on a product's card. "Talk" alone fills no slot.
3. A stamp is recorded on the server for the signed-in wallet, per UTC day, in `lib/daily-hunt.ts`
   (`/api/hunt`; a vote stamps in `/api/votes`, a review stamps after the check passes and the server
   finds the person's own accepted review in their record). It pays nothing. Three stamps fill the card.
   "Day N in a row" is the server's count of UTC days with a stamp, ending today or yesterday, printed
   only at 2 or more and never for a signed-out person.

**Flow 2: post your own app.**

1. First tab: "Post your own app".
2. Paste the link. FAVOUR reads the page and proposes the name, the line, the picture and the colour.
3. The maker confirms or changes each one. Nothing is published that the maker did not see.
4. A picture is required (`pictureAllowsLaunch()`). Then publish.
5. Funding is a separate, later step. A campaign shows money only after the deposit is verified.

**Flow 3: read a project and its feedback round.** (9 Oct 2026)

1. Today: tap a card's picture or name (since the feed of cards replaced the rail and the sheet, the same day).
2. Project page: the app, where it is from, and the feedback round when it is on FAVOUR.
3. The primary is the next step: review it, vote for it, or open it.
4. A maker reaches the same page for an app they posted from "Your apps" on Profile, and reads the
   accepted reviews there. The page shows only what the public results list holds.

**Flow 4: talk in a project's room.** (9 Oct 2026)

1. Talk: the list of rooms. Tap a room.
2. Read. A person who is signed in writes one message and taps "Send". An agent posts with its key and is marked "Agent".
3. An ask is a message with "I can". It pays nothing in version one. The dark pinned card at the top of a room is the maker's own ask, only for an app posted on FAVOUR and only with the points the server gave; its button is the existing review flow. A paid favour stays in the Favours tab.
4. "Report" on any message sends it to review. A hidden message is not served to anyone.
5. Only a signed-in person votes or says "I can". An agent never does.

Rules for both flows:

1. **Four taps or fewer** from the first page to the done state.
2. **One primary button per screen**, and it is the next step of the flow.
3. **No dead end.** Every end state names the next thing to do.
4. **The reward is honest.** Points are paid now. USDC is promised only on a funded campaign.
5. **What does not serve a flow is not on the first page.** History stays in its own tab and shows
   only favours that pass `showInHistory()`. Nothing is deleted.
6. **A flow changes here first.** Change this section in the same PR as the screens.

Built on 8 Oct 2026, on a branch: flow 2 as `/post` with `/api/post-app`, and flow 1 as
`TopProductsLive` (data from `/api/top`) and `/p/<id>` (data from `/api/product/<id>`, check by the
existing `/api/verify-proof`). Flow 1 is three taps: the row, "Write your review", "Send for check".
`TopProductsLive` is mounted at the top of the Campaigns tab in `Feed.tsx`.

Redesigned on 8 Oct 2026, at night, on the same branch: every product surface, the profile,
history and polls draw with `Kit.tsx`. The first page has one dark button and one way to post.
`/post` shows the maker's app as the lead card on every step. The profile shows no level name.
Seen at 390 and 1440 with stand-in data; screenshots in `~/.local/state/favour-look-20261008/redesign/`.

Rebuilt later the same night as the hunt (idea D of `directions.html`, with the sheet of idea C), after
Oscar refused the list twice ("no hierarchy", "make it fun, gamified"). The first tab is `HuntLive` on
`/`; the favours board is `/favours`. The bottom nav is Today, Favours, Polls, History, Profile.
Screenshots in `~/.local/state/favour-look-20261008/hunt/`.

Talk built on 9 Oct 2026, on the same branch: `src/lib/talk.ts` (the store and the rules), `/api/talk`,
`/api/talk/<id>` and its `take` and `report` doors, `/api/admin/talk`, and the two screens on World's kit.
Identity is the session cookie or the agent's bearer key, never the body. Seen at 390, 320 and 1440 with
stand-in reads and once against the dev server with no database; screenshots in
`~/.local/state/favour-look-20261008/talk-built/`.

## Change process

New surface or restyle: check this doc first; if a rule must change, change the
doc in the same PR and say why in the commit.
