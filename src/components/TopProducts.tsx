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
  n: number;
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
}: {
  top: TopList;
  launches: Launch[];
  pictures: Record<string, CampaignPicture>;
  onOpen?: (id: string) => void;
  onOpenLaunch?: (launch: Launch) => void;
}) {
  const source = launches[0]?.source;
  return (
    <section aria-label="Top products today">
      <div className="px-4 pt-4">
        <p className={styles.lead}>
          <span className={`${styles.number} tabular-nums`}>{top.products + launches.length}</span>
          <span className={styles.unit}>top products today</span>
        </p>
        <p className="mt-1 text-sm text-gray-600 tabular-nums">
          {top.products} on FAVOUR to review. {top.acceptedToday} {top.acceptedToday === 1 ? "review" : "reviews"} accepted today, {top.acceptedTotal} in total.
        </p>
      </div>

      <h2 className={`${styles.heading} px-4 text-gray-900`}>On FAVOUR</h2>
      {top.rows.length === 0 ? (
        <p className="px-4 pb-2 pt-1 text-sm text-gray-600">
          No product is on FAVOUR yet.
          {top.waiting > 0 && ` ${top.waiting} ${top.waiting === 1 ? "campaign names" : "campaigns name"} no product, so ${top.waiting === 1 ? "it is" : "they are"} not listed.`}
        </p>
      ) : (
        <>
          <ol className="mt-1">
            {top.rows.map((row) => (
              <Row
                key={row.id}
                rank={row.rank}
                picture={pictures[row.id]}
                name={row.name}
                sub={<><span className="font-semibold text-amber-600">{row.points} pts</span>{" · "}by {row.company}</>}
                n={top.rankedBy === "today" ? row.acceptedToday : row.acceptedTotal}
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
          <h2 className={`${styles.heading} px-4 text-gray-900`}>Launched today</h2>
          <ol className="mt-1">
            {launches.map((l) => (
              <Row
                key={l.id}
                rank={l.rank}
                picture={pictures[l.id]}
                name={l.name}
                sub={l.line ?? new URL(l.url).hostname.replace(/^www\./, "")}
                n={l.score}
                label="points"
                onClick={() => onOpenLaunch?.(l)}
              />
            ))}
          </ol>
          <p className="px-4 pb-4 pt-2 text-xs text-gray-400">
            From {source}, last 24 hours. The points are {source}&apos;s, not FAVOUR&apos;s. These makers have not joined FAVOUR.
          </p>
        </>
      )}
    </section>
  );
}
