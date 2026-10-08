"use client";

import type { CampaignPicture } from "@/lib/campaign-picture";
import type { RankedCampaign, TopList } from "@/lib/rank-campaigns";
import styles from "./TopProducts.module.css";

// THE FIRST THING ON THE FIRST PAGE (Oscar, 8 Oct 2026): products to review, with
// the day's numbers and a top list. Asking for a favour comes after this.
//
// One number leads: how many products are open for review. Under it, one line
// with the reviews accepted today and in total. Then the list, ranked by
// rank-campaigns.ts, and one line that says what it was ranked by.
//
// A row is built for a thumb: the whole row is the button, 72px tall, with the
// product's picture, its name, and one number. Points are amber. No money shows
// here: a proposed pool is not money, so it is not on this screen.
//
// Not used by any screen yet. `/look` shows it in development only.

const RANKED_BY: Record<TopList["rankedBy"], string> = {
  today: "Ranked by reviews accepted in the last 24 hours.",
  total: "No review was accepted today. Ranked by reviews accepted in total.",
  newest: "No review is accepted yet. Newest first.",
};

function count(row: RankedCampaign, by: TopList["rankedBy"]): { n: number; label: string } {
  if (by === "today") return { n: row.acceptedToday, label: "today" };
  return { n: row.acceptedTotal, label: row.acceptedTotal === 1 ? "review" : "reviews" };
}

export function TopProducts({
  top,
  pictures,
  onOpen,
}: {
  top: TopList;
  pictures: Record<string, CampaignPicture>;
  onOpen?: (id: string) => void;
}) {
  return (
    <section aria-label="Products to review">
      <div className="px-4 pt-4">
        <p className={styles.lead}>
          <span className={`${styles.number} tabular-nums`}>{top.products}</span>
          <span className={styles.unit}>{top.products === 1 ? "product" : "products"} to review</span>
        </p>
        <p className="mt-1 text-sm text-gray-600 tabular-nums">
          {top.acceptedToday} {top.acceptedToday === 1 ? "review" : "reviews"} accepted today, {top.acceptedTotal} in total
        </p>
      </div>

      <h2 className={`${styles.heading} px-4 text-gray-900`}>Top today</h2>
      {top.rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-600">No product is open for review yet.</p>
      ) : (
        <ol className="mt-1">
          {top.rows.map((row) => {
            const picture = pictures[row.id];
            const c = count(row, top.rankedBy);
            return (
              <li key={row.id} className="border-b border-gray-200 last:border-b-0">
                <button
                  type="button"
                  onClick={() => onOpen?.(row.id)}
                  className="flex min-h-[72px] w-full items-center gap-3 px-4 py-2 text-left active:bg-gray-50"
                >
                  <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-gray-400">{row.rank}</span>
                  {picture?.url ? (
                    // The product's own picture, from its own server. No referrer is sent.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={picture.url} alt="" loading="lazy" referrerPolicy="no-referrer" className={styles.thumb} />
                  ) : (
                    <span
                      className={`${styles.thumb} ${styles.initial}`}
                      style={{ backgroundColor: `hsl(${picture?.fallback?.hue ?? 0} 12% 92%)` }}
                      aria-hidden="true"
                    >
                      {picture?.fallback?.initial ?? "?"}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-gray-900">{row.name}</span>
                    <span className="block truncate text-xs text-gray-400">
                      <span className="font-semibold text-amber-600">{row.points} pts</span>
                      {" · "}
                      {row.name === row.company ? "no product named yet" : `by ${row.company}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right leading-tight">
                    <span className="block text-[17px] font-bold tabular-nums text-gray-900">{c.n}</span>
                    <span className="block text-xs text-gray-400">{c.label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="px-4 pb-4 pt-2 text-xs text-gray-400">{RANKED_BY[top.rankedBy]}</p>
    </section>
  );
}
