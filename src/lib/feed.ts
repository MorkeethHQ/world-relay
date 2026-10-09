// THE MAIN FEED: ONE CARD PER PROJECT (Oscar, 9 Oct 2026: "The feed needs to be
// crystal clear, favours to projects, review, fetch from hacker news, smart
// contracts there"; his pick: "Project cards A for sure"; "only black though").
//
// Pure, client-safe. It takes what the server already holds (the first page, the
// public vote rows, and for each product on FAVOUR its ask, its feedback round
// and its review task) and makes one card per project. Nothing is fetched and
// nothing is made up:
//   source    where the project is from, with the source's own number for a launch
//   favour    the maker's ask (clamped) and the reward, written ONLY by reward.ts,
//             so points and USDC are never mixed
//   review    progressLine() from project-view.ts, and a 0..1 share only when the
//             campaign itself holds a target
//   contract  escrow with its USDC and address only when the existing rule says the
//             deposit is verified; "points" for a points favour; nothing otherwise
// Order: funded favours, then points favours, then the rest in rail order.

import { clamp, LINE_MAX, textOrNull } from "@/lib/content-rules";
import { huntApps, type HuntApp } from "@/lib/daily-hunt";
import type { FirstPage } from "@/lib/first-page";
import type { VoteRow } from "@/lib/product-votes";
import { progressLine } from "@/lib/project-view";
import { isEscrowV2Task, isFunded, isPointsReward, isRealMoney, rewardAmountLabel } from "@/lib/reward";
import type { Task } from "@/lib/types";

export const ASK_MAX = LINE_MAX;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type FeedSource = { kind: "maker" } | { kind: "launch"; name: string; score: number } | { kind: "vote" };
export type FeedFavour = { ask: string; reward: string | null }; // reward null: a money favour the chain has not funded
export type FeedReview = { line: string; share: number | null }; // share only when the campaign holds a target
export type FeedContract = { kind: "escrow"; usdc: number; address: string | null } | { kind: "points" };

export type FeedCard = {
  id: string;
  kind: HuntApp["kind"];
  stamp: string | null;
  name: string;
  line: string | null;
  url: string;
  host: string;
  picture: { url: string | null; icon: string | null };
  source: FeedSource;
  favour: FeedFavour | null;
  review: FeedReview | null;
  contract: FeedContract | null;
  votes: number | null; // a public count, only for a candidate the server counted
  mine: boolean;
};

/** The review piece's task, as far as the feed reads it. */
export type ReviewTask = Pick<Task, "rewardType" | "bountyUsdc" | "escrowTxHash" | "onChainId" | "escrowV2Address">;

/** What the server holds for one product on FAVOUR, beyond the first page. */
export type FavourDetail = {
  ask: string;
  accepted: number;
  acceptedIsFloor: boolean;
  target: number | null;
  task: ReviewTask | null; // null: the task could not be read
  /** The current escrow contract from config, for a funded v2 task with no pinned address. */
  escrowAddress?: string | null;
};

export function sourceText(s: FeedSource): string {
  if (s.kind === "launch") return `${s.name} · ${s.score}`;
  if (s.kind === "vote") return "Vote list";
  return "Posted by its maker";
}

/** The reward, by reward.ts alone. USDC only when the existing label rule says the task is real money. */
export function rewardOf(task: ReviewTask): string | null {
  if (isPointsReward(task)) return rewardAmountLabel(task);
  if (isRealMoney(task)) return rewardAmountLabel(task);
  return null;
}

/** The contract line. Escrow only for a v2 task whose stored fund tx has the real shape:
 *  the server stores that hash only after the receipt was verified (api/escrow-v2). A v1
 *  task never names its contract here, because that address is retired. */
export function contractOf(task: ReviewTask, escrowAddress?: string | null): FeedContract | null {
  if (isPointsReward(task)) return { kind: "points" };
  if (isEscrowV2Task(task) && isFunded(task) && TX_HASH.test(String(task.escrowTxHash))) {
    const pinned = task.escrowV2Address ?? null;
    const address = pinned && ADDRESS.test(pinned) ? pinned : escrowAddress && ADDRESS.test(escrowAddress) ? escrowAddress : null;
    return { kind: "escrow", usdc: task.bountyUsdc, address };
  }
  return null;
}

export function reviewOf(d: Pick<FavourDetail, "accepted" | "acceptedIsFloor" | "target">): FeedReview {
  const line = progressLine(d.accepted, d.acceptedIsFloor, d.target);
  const share = d.target !== null && d.target > 0 && !d.acceptedIsFloor ? Math.min(1, Math.max(0, d.accepted / d.target)) : null;
  return { line, share };
}

function favourCard(a: HuntApp, d: FavourDetail | undefined): Pick<FeedCard, "favour" | "review" | "contract"> {
  if (!d) return { favour: null, review: null, contract: null };
  const ask = textOrNull(d.ask);
  // With no task to read, the campaign's own points are still a points reward by the
  // type's own rule (campaign-draft-shape.ts: no funded state), written by reward.ts.
  const task: ReviewTask = d.task ?? { rewardType: "points", bountyUsdc: a.points ?? 0, escrowTxHash: null, onChainId: null, escrowV2Address: null };
  return {
    favour: ask ? { ask: clamp(ask, ASK_MAX), reward: rewardOf(task) } : null,
    review: reviewOf(d),
    contract: contractOf(task, d.escrowAddress),
  };
}

const tier = (c: FeedCard) => (c.contract?.kind === "escrow" ? 0 : c.favour && c.contract?.kind === "points" ? 1 : 2);

/** One card per project, in rail order, then funded first and points next. */
export function feedCards(page: FirstPage, votes: readonly VoteRow[], details: Record<string, FavourDetail>): FeedCard[] {
  const cards = huntApps(page, votes).map((a): FeedCard => {
    const source: FeedSource = a.kind === "launch" ? { kind: "launch", name: a.source ?? "", score: a.score ?? 0 } : a.kind === "vote" ? { kind: "vote" } : { kind: "maker" };
    const parts = a.kind === "favour" ? favourCard(a, details[a.id]) : { favour: null, review: null, contract: null };
    return {
      id: a.id, kind: a.kind, stamp: a.stamp, name: a.name, line: a.line, url: a.url, host: a.host,
      picture: { url: a.picture, icon: a.icon },
      source, ...parts,
      votes: a.kind === "vote" ? a.votes : null,
      mine: a.mine,
    };
  });
  return cards.map((c, i) => ({ c, i })).sort((x, y) => tier(x.c) - tier(y.c) || x.i - y.i).map((x) => x.c);
}

/** The one action's word. The label for a review is the reward itself, from reward.ts. */
export function actionOf(c: FeedCard): { kind: "review"; label: string } | { kind: "vote" } | { kind: "talk" } | null {
  if (c.kind === "favour") return c.favour?.reward ? { kind: "review", label: `Review · ${c.favour.reward}` } : null;
  if (c.kind === "vote") return { kind: "vote" };
  return { kind: "talk" };
}

/** The quiet contract line. */
export function contractLine(c: FeedContract): string {
  return c.kind === "escrow" ? `${c.usdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC in escrow` : "Points only";
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
