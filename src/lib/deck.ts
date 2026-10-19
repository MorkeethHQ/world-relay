// THE DECK, storage side. One list: Oscar's seeds (merged with their posted
// twins), the posted projects from the picker, then Show HN. Pictures: the
// project's own record, a Show HN page's share picture, or null (the screen
// draws the funky art). Server only. Nothing here moves money.
import { listProjects } from "@/lib/projects";
import { getPayPlan } from "@/lib/pay-slots";
import { cardFromHn, cardFromProject, orderDeck, type DeckCard } from "@/lib/deck-view";
import { OSCAR_SEEDS, mergeSeeds } from "@/lib/deck-seed";
import { hnImage, listShowHn } from "@/lib/hn";

const HN_IMAGES = 12; // only the first dozen get a picture read; the rest draw art

export async function listDeck(): Promise<DeckCard[]> {
  const [projects, hits] = await Promise.all([listProjects().catch(() => []), listShowHn()]);
  const posted = await Promise.all(projects.map(async (p) => {
    const plan = p.status === "published" ? await getPayPlan(p.id).catch(() => null) : null;
    return cardFromProject(p, "posted", plan?.perReviewUsd ?? null);
  }));
  const { front, rest } = mergeSeeds(OSCAR_SEEDS, posted);
  const hn = await Promise.all(hits.map(async (h, i) => cardFromHn(h, i < HN_IMAGES ? await hnImage(h.url) : null)));
  return orderDeck([...front, ...rest, ...hn]);
}
