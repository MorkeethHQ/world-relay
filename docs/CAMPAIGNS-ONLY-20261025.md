# Campaign-only front door

Source decision: Oscar, 25 Oct, quoted in FAVOUR-NEXT BRIEF.md.

Home and /board expose curated campaign cards only. Individual task data is retained in the task API, campaign detail, proof routes and personal history. No raw task feed, daily mission, starter task or one-off composer renders on the public home. The task rows were not deleted or changed.

Image source: Unsplash https://images.unsplash.com/photo-1521737711867-e3b97375f902 . Downloaded as public/campaign-contribution.jpg. This is an illustrative collaboration photograph, not proof of a campaign participant. The source is named on the campaign stage. Existing campaign-specific images remain on dated campaign cards.

Removed for VIBE-NEXT: /apps and /post now redirect home; /project/[id], /project/[id]/feedback, /story/[slug] and /drop/2026-w43 also redirect home. Deleted AppsToCheck, PostApp, CuratedHome, ProjectsHome, Deck, ProjectView and FeedbackForm UI. Removed Post from bottom nav, app entry from home, /api/apps, /api/apps/vote, /api/post-app, /api/post-app/read and /api/cron/publish-due including cron schedule. Projects API lists published campaigns only. Existing campaign funding API and stored records retained. Old pure helper code remains dormant for compatibility; no YES endpoint remains.

Tests for removed app screens/endpoints were retired; pure helper tests remain. No Vibe repository inspected or changed, so presence there is not asserted.
