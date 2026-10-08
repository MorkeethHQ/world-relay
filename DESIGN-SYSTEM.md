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

## Components (strict, Oscar 8 Oct 2026: "We need strict rules on design, compeontsn and how flow swork")

One job, one component. A screen that shows a product uses one of these and nothing else.
A new kind of card needs a new row in this table in the same PR, or it does not merge.
Guard: `design-components.guard.test.ts` reads this table.

| Component | Its one job | It must never |
|---|---|---|
| `TopProducts.tsx` | The top of the first page: the day's products, three outside launches at most, and the door "Post your own app" | Mix FAVOUR's numbers with an outside source's numbers. Show a proposed pool as money. List a campaign that names no product |
| `ProductCampaignCard.tsx` | One product in a list: its picture in a window, its name, one line, one button | Show green for a budget that is not funded. Use a picture from another product |
| `FeaturedProduct.tsx` | One product fills the screen. Used for one product at a time | Take a colour except through `productColour()`. Use a gradient. Move |
| `HunterCard.tsx` | The top of the profile: products reviewed, reviews accepted, products launched | Show a level, a rank or a badge with no rule behind it. Show a GitHub name that is not verified |
| `TopProductsLive.tsx` | `TopProducts` with its data from `/api/top`, and its loading and error states. The one line a first page mounts | Draw a product row itself. Choose a link for the server to read |
| `ProductScreen.tsx` | Flow 1 on one route, `/p/<id>`: the product, the review, the result of the check | Show a result the check did not give. Name money. Call a held review accepted or refused |
| `HunterCardLive.tsx` | `HunterCard` with the signed-in person's own data, at the top of the profile page | Ask for another person's record. Show zeros to a person who is not signed in |
| `VoteList.tsx` | A short list of real products a person can vote for. One tap on a row is one vote | Show a count the server did not give. Show a zero for a count that could not be read. Let one wallet vote twice. Call a product with votes a campaign |
| `PostYourApp.tsx` | Flow 2 on one route, `/post`: paste the link, confirm what was read, write the ask, post | Publish what the maker did not see. Name money. Publish with no picture. Trust a picture link the server did not read, except the maker's own |
| `RewardBadge.tsx` | Every reward amount, points or USDC | Be replaced by a hand-written amount |

Rules for every component in the table:

1. **Four states exist:** empty, loading, error and filled. An empty state says what to do next.
2. **A number carries its source or its time.** "63 points" names whose points. "0 reviews" says "today".
3. **Real data only.** A zero is shown as a zero. An example is shown only on `/look` and says "example".
4. **Phone first.** It is designed at 390 px. A row is at least 72 px tall and is one tap target.
5. **Text is short.** One heading, one line under it. No paragraph above the first thing a person can tap.
6. **Nothing pulses, bounces or blinks.** One slow movement is allowed: the capture inside `ProductCampaignCard`.
7. **The words come from the product.** FAVOUR does not write a product's name or line for a maker.

## Flows (strict)

A person who opens FAVOUR does one of two things. Every screen serves one of the two.

**Flow 1: review a product and get paid.**

1. First page: `TopProducts`. Tap a product.
2. Product screen: the picture, what the maker asks, the reward. One primary button.
3. The person tries the product and writes the review.
4. The check runs. Passed: the reward is shown at once. Not passed: the reason is shown, with what to change.

**Flow 2: post your own app.**

1. First page: "Post your own app".
2. Paste the link. FAVOUR reads the page and proposes the name, the line, the picture and the colour.
3. The maker confirms or changes each one. Nothing is published that the maker did not see.
4. A picture is required (`pictureAllowsLaunch()`). Then publish.
5. Funding is a separate, later step. A campaign shows money only after the deposit is verified.

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

## Change process

New surface or restyle: check this doc first; if a rule must change, change the
doc in the same PR and say why in the commit.
