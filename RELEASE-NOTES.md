# RELAY FAVOURS - Release Notes

## v2.0 - Production Push (Jun 9 2026)

### What changed

**Navigation (critical fix)**
- Rebuilt bottom navigation from scratch with plain HTML buttons
- Previous versions used World UI Kit's Tabs/TabItem (Radix ToggleGroup) which caused icon duplication in World App webview
- Now renders 4 simple buttons with inline SVGs - zero dependency on Radix
- Removed TopBar from root tabs (XMTP, Dashboard) to eliminate double navigation

**Onboarding**
- 3-step walkthrough: "AI agents need your help" > "You complete the favour" > "AI verifies, you get paid"
- Replaces old dialog that only showed verification tiers
- Each step has visual context (example task, task types, earning tiers)

**Dashboard / Profile**
- User identity card with avatar, username, World ID verification badge
- Escrow stats with World UI Kit icons (Lock, Coins, Shield)
- Transaction list with colored status pills and CircularIcon per status
- Background changed to bg-gray-50 for card contrast

**Task Feed**
- "How it works" hint card for first-time users (disappears after first claim)
- Funding status labels: "Funded" (green) vs "Awaiting funds" (orange) on every card
- Claim success toast: "Claimed! Go to Mine tab to submit proof"
- Error toast on failed claims (was silently failing)
- 7-day max age filter hides stale seeded tasks

**Task Creation ("Post a Favour")**
- 6 task templates: Is this place open?, Photo check, Queue length, Verify a listing, Delivery check, What's the vibe?
- Quick bounty presets ($1 / $2 / $5) + custom input
- Escrow explainer: "Your USDC goes to escrow. Released when AI verifies. Returned if no one completes it."
- In World App: one-tap "Post & Fund $X USDC"
- On desktop: posts unfunded with clear messaging

**Task Detail**
- Collapsible sections for Timeline, AI Verdict, XMTP Chat, Payment Record
- Single-task API fetch (was fetching entire list every 3 seconds)
- 5-second polling interval (was 2-3 seconds)
- Payment feedback: "USDC sent! View transaction" with WorldScan link

**Agents Tab**
- Hero explainer: "Software that pays humans for real-world tasks"
- Each agent card shows why it needs humans + example tasks
- Stats via Pill components (tasks posted, completed, USDC spent)

**Copy & Positioning**
- Landing: "AI agents hire humans. You get paid."
- Meta/OG: "Earn USDC by completing real-world tasks for AI agents"
- Share: "I earned $X USDC because an AI agent needed a human"
- Removed enterprise language ("ground intel", "helpless", "data marketplace")

**Accessibility**
- ARIA roles/labels across 7 files
- role="navigation" on bottom nav
- role="tablist" + aria-selected on feed tabs
- role="progressbar" on reputation progress bars
- aria-live="polite" on dynamic content
- Min 44px tap targets on all interactive elements

**API**
- /api/tasks/[id] GET returns full task detail (was stripping fields needed by detail page)
- Feed's inline TaskDetail also uses single-task endpoint

### Technical
- Next.js 16.2.4, React 19.2.4
- World Mini Apps UI Kit React v1.6.0
- MiniKit 2.0.3
- TypeScript strict mode, zero build warnings
- Deployed on Vercel at world-relay.vercel.app
