import { notFound } from "next/navigation";
import { FeaturedProduct } from "@/components/FeaturedProduct";
import { ProductCampaignCard } from "@/components/ProductCampaignCard";
import { TopProducts } from "@/components/TopProducts";
import { TopProductsLive } from "@/components/TopProductsLive";
import { HunterCard } from "@/components/HunterCard";
import { hunterProfile } from "@/lib/hunter-profile";
import { campaignPicture } from "@/lib/campaign-picture";
import { rankCampaigns } from "@/lib/rank-campaigns";
import { fetchLaunches } from "@/lib/launch-feed";
import { fetchProduct } from "@/lib/product-fetch";
import type { CampaignResult, PublicCompanyCampaign } from "@/lib/campaign-draft-shape";

// The live site's own numbers, read when the page is built. Nothing is made up:
// if the live site cannot be read, the list is empty and the page says so.
const LIVE = "https://world-relay.vercel.app";
async function liveCampaigns(): Promise<Array<{ campaign: PublicCompanyCampaign; results: CampaignResult[] }> | null> {
  try {
    const list = await fetch(`${LIVE}/api/campaigns/company`, { cache: "no-store" }).then((r) => r.json());
    return await Promise.all(
      (list.campaigns as PublicCompanyCampaign[]).map(async (campaign) => {
        const one = await fetch(`${LIVE}/api/campaigns/company/${encodeURIComponent(campaign.id)}`, { cache: "no-store" }).then((r) => r.json());
        return { campaign, results: (one.results ?? []) as CampaignResult[] };
      }),
    );
  } catch {
    return null;
  }
}

// A development-only page to look at the campaign card. It answers 404 in
// production. The three products are real; the one funded budget is an example
// and says so, because no campaign is funded yet.
export default async function LookPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const live = await liveCampaigns();
  const top = rankCampaigns(live ?? []);
  // Today's outside launches, then each product's own page read through the fence
  // for its picture and icon. A page that cannot be read leaves the row its initial.
  const launches = await fetchLaunches();
  const read = await Promise.all(launches.map((l) => fetchProduct(l.url)));
  const pictures = Object.fromEntries([
    ...(live ?? []).map(({ campaign: c }) => [c.id, campaignPicture({ productName: c.productName || c.company, productUrl: c.productUrl })]),
    ...launches.map((l, i) => {
      const r = read[i];
      return [l.id, campaignPicture({ productName: l.name, productUrl: l.url, shareImage: r.ok ? r.proposal.image : null, icon: r.ok ? r.proposal.icon : null })];
    }),
  ]);
  const cards = [
    {
      name: "STRIVE", line: "A run is one real session with your coding agent. See its map, add your story.",
      picture: { ...campaignPicture({ productName: "STRIVE", productUrl: "https://agentic-strava.vercel.app" }), source: "capture" as const, url: "/look/strive.jpg", credit: "The live product at agentic-strava.vercel.app", fallback: null },
      budget: { usdc: 20, funded: true, reviewsLeft: 10 }, actionLabel: "Try it",
    },
    {
      name: "FAVOUR", line: "Ask favours, complete tasks, earn USDC. AI verifies everything.",
      picture: campaignPicture({ productName: "FAVOUR", productUrl: "https://world-relay.vercel.app", shareImage: "https://world-relay.vercel.app/og-image.png" }),
      budget: null, votes: 0, actionLabel: "Vote it up",
    },
    {
      name: "Wave Radio", line: "Type a phrase. Hear the show it made, from 30 episodes.",
      picture: campaignPicture({ productName: "Wave Radio", productUrl: "https://waveradio-five.vercel.app" }),
      budget: null, votes: 0, actionLabel: "Vote it up",
    },
  ];
  return (
    <main className="mx-auto max-w-[390px] space-y-4 bg-gray-50 p-3 pb-24">
      <p className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600">
        First page, top part. {live ? "FAVOUR numbers are the live site's, and the launch list is today's Show HN, both read just now." : "The live site could not be read, so the list is empty."}
      </p>
      <div className="-mx-3 border-y border-gray-200 bg-white">
        <TopProducts top={top} launches={launches} pictures={pictures} />
      </div>
      <p className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600">
        The same part as the app will mount it: `TopProductsLive`, with its data from this server&apos;s own /api/top.
        This worktree has no database, so it lists no product on FAVOUR. A tap on a product opens /p/&lt;id&gt;.
      </p>
      <div className="-mx-3 border-y border-gray-200 bg-white">
        <TopProductsLive />
      </div>
      <p className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600">
        Profile, top part. First a new person: real zeros. Then example numbers, to show the full card.
        A person&apos;s real record needs their sign-in, so it cannot be read on this page.
      </p>
      <HunterCard name="@new_person" profile={hunterProfile([])} />
      <HunterCard
        name="@example"
        github={{ name: "example", verified: true }}
        profile={hunterProfile(
          [
            { campaignId: "a", campaignLabel: "STRIVE", points: 10, at: "2026-10-07T10:00:00Z" },
            { campaignId: "a", campaignLabel: "STRIVE", points: 10, at: "2026-10-05T10:00:00Z" },
            { campaignId: "b", campaignLabel: "Wave Radio", points: 10, at: "2026-10-03T10:00:00Z" },
            { campaignId: null, points: 3, at: "2026-09-20T10:00:00Z" },
          ],
          [{ status: "published", productName: "STRIVE", productUrl: "https://agentic-strava.vercel.app" }],
        )}
      />
      <p className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600">
        Development preview. The $20 budget is an example: no campaign is funded.
      </p>
      {cards.map((c) => <ProductCampaignCard key={c.name} {...c} />)}
      <p className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600">
        Below: the featured screen, three times. Voting is not built, so the label is an example.
        First the colour a maker could pick (an example, STRIVE declares none). Then Wave Radio in
        the colour its own page declares. Then a green that is refused, so the screen stays ink.
      </p>
      {[
        { ...cards[0], colour: "#4f46e5" },
        { ...cards[2], colour: "#0d0d0d", picture: campaignPicture({ productName: "Wave Radio", productUrl: "https://waveradio-five.vercel.app", shareImage: "https://waveradio-five.vercel.app/og-card.png" }) },
        { ...cards[1], colour: "#16a34a" },
      ].map((c) => (
        <div key={c.name} className="-mx-3" style={{ ["--nav" as string]: "55px" }}>
          <FeaturedProduct label="Example: project of the week" {...c} />
        </div>
      ))}
    </main>
  );
}
