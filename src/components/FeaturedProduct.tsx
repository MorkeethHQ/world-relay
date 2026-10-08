"use client";

import type { CampaignPicture } from "@/lib/campaign-picture";
import { productColour } from "@/lib/product-colour";
import type { CampaignBudget } from "./ProductCampaignCard";
import styles from "./FeaturedProduct.module.css";

// ONE PRODUCT FILLS THE SCREEN (Oscar, 8 Oct 2026: look C, for the voted project).
// This is the one screen where a product's own colour may fill the background.
// The colour enters through productColour and nowhere else: a colour that reads
// as money (green) or points (amber) is refused, and the screen is ink instead.
//
// The fill is one flat colour. The money and the one primary button sit on a
// white sheet, so green still means funded USDC and still reads on any product.
// Nothing on this screen moves.
//
// Not used by any screen yet. `/look` shows it in development only. Voting is
// not built, so the caller passes the label; this file does not claim a vote.

export function FeaturedProduct({
  label,
  name,
  line,
  picture,
  colour,
  budget,
  votes,
  actionLabel,
  onAction,
}: {
  label: string;
  name: string;
  line: string | null;
  picture: CampaignPicture;
  colour: string | null;
  budget: CampaignBudget | null;
  votes?: number;
  actionLabel: string;
  onAction?: () => void;
}) {
  const own = productColour(colour);
  const onInk = !own || own.onFill === "white";
  return (
    <section
      className={`${styles.wall} ${onInk ? styles.onDark : styles.onLight}`}
      style={own ? { backgroundColor: own.fill } : undefined}
    >
      <div className={styles.column}>
        <p className={styles.label}>{label}</p>
        <h2 className={styles.name}>{name}</h2>
        {line && <p className={styles.line}>{line}</p>}

        {picture.url && (
          <figure className={`${styles.frame} ${picture.source === "capture" ? styles.fill : ""}`}>
            {/* The product's own picture, from its own server. No referrer is sent. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={picture.url} alt={`${name}: ${picture.credit.toLowerCase()}`} referrerPolicy="no-referrer" />
            <figcaption className={styles.credit}>{picture.credit}</figcaption>
          </figure>
        )}

        <div className={`${styles.sheet} flex items-center justify-between gap-3 rounded-2xl bg-white p-4`}>
          <div className="min-w-0 leading-tight">
            {budget && budget.funded ? (
              <>
                <span className="text-[17px] font-bold tabular-nums text-success-600">${budget.usdc} USDC</span>
                <span className="block text-xs text-gray-400">for {budget.reviewsLeft} more {budget.reviewsLeft === 1 ? "review" : "reviews"}</span>
              </>
            ) : (
              <>
                <span className="text-sm font-semibold text-gray-400">Not funded yet</span>
                {typeof votes === "number" && (
                  <span className="block text-xs text-gray-400 tabular-nums">{votes} {votes === 1 ? "vote" : "votes"}</span>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onAction}
            className="min-h-[44px] shrink-0 rounded-xl bg-gray-900 px-5 text-sm font-semibold text-white active:scale-[0.98]"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
