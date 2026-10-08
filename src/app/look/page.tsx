import { notFound } from "next/navigation";
import { ProductCampaignCard } from "@/components/ProductCampaignCard";
import { campaignPicture } from "@/lib/campaign-picture";

// A development-only page to look at the campaign card. It answers 404 in
// production. The three products are real; the one funded budget is an example
// and says so, because no campaign is funded yet.
export default function LookPage() {
  if (process.env.NODE_ENV === "production") notFound();
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
    <main className="mx-auto max-w-md space-y-4 bg-gray-50 p-3">
      <p className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600">
        Development preview. The $20 budget is an example: no campaign is funded.
      </p>
      {cards.map((c) => <ProductCampaignCard key={c.name} {...c} />)}
    </main>
  );
}
