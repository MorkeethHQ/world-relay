import { notFound } from "next/navigation";
import { FeaturedProduct } from "@/components/FeaturedProduct";
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
