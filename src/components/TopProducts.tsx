"use client";

import type { ReactNode } from "react";
import type { CampaignPicture } from "@/lib/campaign-picture";
import type { Launch } from "@/lib/launch-feed";
import type { TopList } from "@/lib/rank-campaigns";
import styles from "./TopProducts.module.css";

// THE FIRST THING ON THE FIRST PAGE (Oscar, 8 Oct 2026): products, with the day's
// numbers and a top list. Asking for a favour comes after this. "TOP today needs
// to be products for sure": every row is a product with a name and a link.
//
// Small on purpose (Oscar, 8 Oct 2026: "its a big component now on phone, and a
// lot of text at the top"): one heading, one line of numbers, then rows.
//
// Two groups, and they are never mixed, because their numbers mean different
// things:
//   1. On FAVOUR: products a maker put here. Ranked by reviews FAVOUR accepted.
//      These can be reviewed for points.
//   2. Launched today: products from an outside launch list (launch-feed.ts). The
//      number is the SOURCE's number and carries the source's name. The maker did
//      not ask FAVOUR for anything, so these cannot be reviewed for points yet.
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

function Row({
  rank, picture, name, sub, n, label, onClick,
}: {
  rank: number;
  picture: CampaignPicture | undefined;
  name: string;
  sub: ReactNode;
  n: number | string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <li className="border-b border-gray-200 last:border-b-0">
      <button type="button" onClick={onClick} className="flex min-h-[72px] w-full items-center gap-3 px-4 py-2 text-left active:bg-gray-50">
        <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-gray-400">{rank}</span>
        {picture?.url || picture?.icon ? (
          // The product's own picture, from its own server. No referrer is sent.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={(picture.url || picture.icon)!} alt="" loading="lazy" referrerPolicy="no-referrer" className={styles.thumb} />
        ) : (
          <span
            className={`${styles.thumb} ${styles.initial}`}
            style={{ backgroundColor: `hsl(${picture?.fallback?.hue ?? 0} 12% 92%)` }}
            aria-hidden="true"
          >
            {picture?.fallback?.initial ?? Array.from(name)[0]?.toUpperCase() ?? "?"}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-gray-900">{name}</span>
          <span className="block truncate text-xs text-gray-400">{sub}</span>
        </span>
        <span className="shrink-0 text-right leading-tight">
          <span className="block text-[17px] font-bold tabular-nums text-gray-900">{n}</span>
          <span className="block text-xs text-gray-400">{label}</span>
        </span>
      </button>
    </li>
  );
}

export function TopProducts({
  top,
  launches,
  pictures,
  onOpen,
  onOpenLaunch,
  onPost,
}: {
  top: TopList;
  launches: Launch[];
  pictures: Record<string, CampaignPicture>;
  onOpen?: (id: string) => void;
  onOpenLaunch?: (launch: Launch) => void;
  onPost?: () => void;
}) {
  const source = launches[0]?.source;
  return (
    <section aria-label="Top products today">
      <h2 className={`${styles.heading} px-4 text-gray-900`}>Top today</h2>
      <p className="px-4 text-xs text-gray-400 tabular-nums">
        {top.products} on FAVOUR · {top.acceptedToday} {top.acceptedToday === 1 ? "review" : "reviews"} accepted today
      </p>
      {top.rows.length === 0 ? (
        <p className="px-4 pt-2 text-sm text-gray-600">No product is on FAVOUR yet.</p>
      ) : (
        <>
          <ol className="mt-1">
            {top.rows.map((row) => (
              <Row
                key={row.id}
                rank={row.rank}
                picture={pictures[row.id]}
                name={row.name}
                // "by" is shown only for a company Oscar checked. Anyone can post any link,
                // so an unchecked row says so and names no company.
                sub={<><span className="font-semibold text-amber-600">{row.points} pts</span>{" · "}{row.makerChecked ? `by ${row.company}` : "maker not checked"}</>}
                n={top.rankedBy === "today" ? row.acceptedToday : row.totalIsFloor ? `${row.acceptedTotal}+` : row.acceptedTotal}
                label={top.rankedBy === "today" ? "today" : row.acceptedTotal === 1 ? "review" : "reviews"}
                onClick={() => onOpen?.(row.id)}
              />
            ))}
          </ol>
          <p className="px-4 pb-1 pt-2 text-xs text-gray-400">{RANKED_BY[top.rankedBy]}</p>
        </>
      )}

      {launches.length > 0 && (
        <>
          <p className={`${styles.group} px-4 text-gray-400`}>Launched today on {source}</p>
          <ol>
            {launches.map((l) => (
              <Row
                key={l.id}
                rank={l.rank}
                picture={pictures[l.id]}
                name={l.name}
                sub={l.line ?? new URL(l.url).hostname.replace(/^www\./, "")}
                n={l.score}
                label="HN points"
                onClick={() => onOpenLaunch?.(l)}
              />
            ))}
          </ol>
          <p className="px-4 pb-2 pt-2 text-xs text-gray-400">
            {source}&apos;s points. Not on FAVOUR yet.
          </p>
        </>
      )}
      {/* The second door (Oscar, 8 Oct 2026: "someone should post their own app").
          Secondary shape: doing a review is the first thing on this screen. */}
      <div className="px-4 pb-4 pt-1">
        <button
          type="button"
          onClick={onPost}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 active:scale-[0.98]"
        >
          Post your own app
        </button>
      </div>
    </section>
  );
}
