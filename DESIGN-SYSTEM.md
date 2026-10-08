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

## Change process

New surface or restyle: check this doc first; if a rule must change, change the
doc in the same PR and say why in the commit.
