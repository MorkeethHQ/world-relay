"use client";

import type { CampaignPicture } from "@/lib/campaign-picture";
import styles from "./ProductCampaignCard.module.css";

// THE PRODUCT IS THE CARD (Oscar, 8 Oct 2026: look A as the main look).
// A campaign card is a window onto the product itself. FAVOUR stays quiet under
// it, so every campaign looks like its product and none looks like the last one.
//
// The one device: when the picture is a capture of the live product, it scrolls
// slowly inside the window, the way a person would scroll the product. It stops
// for people who ask for reduced motion. Nothing else on the card moves.
//
// DESIGN-SYSTEM.md still rules the chrome: ink text, one primary button, 44px
// targets, green ONLY for real escrowed money, amber only for points. A budget
// that is not funded is shown in gray, never in green.
//
// Not used by any screen yet. `/look` shows it in development only.

export type CampaignBudget = { usdc: number; funded: boolean; reviewsLeft: number };

export function ProductCampaignCard({
  name,
  line,
  picture,
  budget,
  votes,
  actionLabel,
  onAction,
}: {
  name: string;
  line: string | null;
  picture: CampaignPicture;
  budget: CampaignBudget | null;
  votes?: number;
  actionLabel: string;
  onAction?: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-3xl border border-gray-200 bg-white">
      <div className={styles.window}>
        {picture.url ? (
          // A product's own picture comes from its own server, so next/image's
          // fixed host list cannot serve it. No referrer is sent to that server.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={picture.url}
            alt={`${name}: ${picture.credit.toLowerCase()}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={picture.source === "capture" ? styles.pan : styles.cover}
          />
        ) : (
          <div
            className={styles.fallback}
            style={{ backgroundColor: `hsl(${picture.fallback?.hue ?? 0} 12% 92%)` }}
            aria-hidden="true"
          >
            <span>{picture.fallback?.initial ?? "?"}</span>
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="flex items-center gap-2">
          {picture.icon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picture.icon} alt="" width={20} height={20} loading="lazy" referrerPolicy="no-referrer" className="h-5 w-5 rounded" />
          )}
          <h3 className={`${styles.name} text-gray-900`}>{name}</h3>
        </div>
        {line && <p className="mt-1 text-sm text-gray-600">{line}</p>}
        <p className="mt-1 text-xs text-gray-400">{picture.credit}</p>

        <div className="mt-3 flex items-center justify-between gap-3">
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
    </article>
  );
}
