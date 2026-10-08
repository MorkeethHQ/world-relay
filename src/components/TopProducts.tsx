"use client";

import type { ReactNode } from "react";
import type { CampaignPicture } from "@/lib/campaign-picture";
import type { Launch } from "@/lib/launch-feed";
import type { VoteRow } from "@/lib/product-votes";
import type { TopList } from "@/lib/rank-campaigns";
import styles from "./TopProducts.module.css";

// THE FIRST THING ON THE FIRST PAGE (Oscar, 8 Oct 2026). Products, and nothing
// else: "TOP today needs to be products for sure".
//
// ONE PIECE, ONE ROW (Oscar, 8 Oct 2026: "it feels like design components are
// faling to pieces", "we want the apple and world app feeling! Clean good
// overview, not too much copy"). The whole section is this file:
//   - one heading, "Today"
//   - one lead card: one product, its picture first
//   - one kind of row for everything else: an icon, a name, one line, one pill
//   - one door at the end: "Post your own app"
// The only dark button is on the lead card. Every pill in a row is grey.
//
// Three groups, never mixed, because their numbers mean different things:
//   On FAVOUR          a maker posted it. It can be reviewed for points.
//   Vote               real products a person can vote for. A vote pays nothing.
//   New on Hacker News an outside launch list. The points are Hacker News's.
// A group with nothing in it is not drawn. No sentence explains an empty group.
//
// Honest numbers: a count is shown only when the server gave one. Points are
// amber. No money shows here: a proposed pool is not money.

type Lead =
  | { kind: "favour"; id: string; name: string; line: string | null; picture: string; points: number }
  | { kind: "vote"; row: VoteRow; picture: string };

function Icon({ src, name, hue }: { src: string | null; name: string; hue?: number }) {
  return src ? (
    // The product's own picture, from its own server. No referrer is sent.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className={styles.icon} />
  ) : (
    <span className={`${styles.icon} ${styles.initial}`} style={hue === undefined ? undefined : { backgroundColor: `hsl(${hue} 12% 92%)` }} aria-hidden="true">
      {Array.from(name)[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function Row({
  icon, name, sub, pill, pillOn = true, label, disabled, last, onClick,
}: {
  icon: ReactNode;
  name: string;
  sub: ReactNode;
  pill: ReactNode;
  pillOn?: boolean;
  label: string;
  disabled?: boolean;
  last: boolean;
  onClick?: () => void;
}) {
  return (
    <li>
      <button type="button" className="flex min-h-[72px] w-full items-center gap-3 px-4 py-2 text-left active:bg-gray-50 disabled:opacity-100" onClick={onClick} disabled={disabled} aria-label={label}>
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold text-gray-900">{name}</span>
          <span className="block truncate text-[13px] text-gray-400">{sub}</span>
        </span>
        <span className={`${styles.pill} ${pillOn ? "bg-gray-100 text-gray-900" : "bg-white text-gray-400"}`}>{pill}</span>
      </button>
      {!last && <div className={styles.rule} />}
    </li>
  );
}

const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");
const voteWord = (row: VoteRow) => (row.mine ? (row.votes === null ? "Voted" : `Voted · ${row.votes}`) : "Vote");

export function TopProducts({
  top,
  launches,
  pictures,
  votes = [],
  votesFrom,
  votingId = null,
  voteProblem = null,
  onOpen,
  onVote,
  onOpenLaunch,
  onPost,
}: {
  top: TopList;
  launches: Launch[];
  pictures: Record<string, CampaignPicture>;
  votes?: VoteRow[];
  votesFrom?: string;
  votingId?: string | null;
  voteProblem?: string | null;
  onOpen?: (id: string) => void;
  onVote?: (row: VoteRow) => void;
  onOpenLaunch?: (launch: Launch) => void;
  onPost?: () => void;
}) {
  // The lead is the first product with a picture: one on FAVOUR first, since it
  // can be reviewed now, then one to vote for. No picture, no lead card.
  const first = top.rows.find((r) => pictures[r.id]?.url);
  const firstVote = first ? undefined : votes.find((v) => v.image);
  const lead: Lead | null = first
    ? { kind: "favour", id: first.id, name: first.name, line: null, picture: pictures[first.id].url!, points: first.points }
    : firstVote ? { kind: "vote", row: firstVote, picture: firstVote.image! } : null;
  const rows = top.rows.filter((r) => !(lead?.kind === "favour" && lead.id === r.id));
  const voteRows = votes.filter((v) => !(lead?.kind === "vote" && lead.row.id === v.id));
  const source = launches[0]?.source;

  return (
    <section aria-label="Products today" className="pb-5">
      <h2 className={`${styles.heading} px-4 text-gray-900`}>Today</h2>

      {lead && (
        <div className="px-4">
          <button
            type="button"
            className={`${styles.lead} min-h-[72px] w-full active:scale-[0.99]`}
            onClick={() => (lead.kind === "favour" ? onOpen?.(lead.id) : onVote?.(lead.row))}
            disabled={lead.kind === "vote" && (lead.row.mine || votingId === lead.row.id)}
            aria-label={lead.kind === "favour" ? `Review ${lead.name}` : lead.row.mine ? `You voted for ${lead.row.name}` : `Vote for ${lead.row.name}`}
          >
            {/* The product's own picture, from its own server. No referrer is sent. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lead.picture} alt="" referrerPolicy="no-referrer" className={styles.leadPicture} />
            <span className="flex items-center gap-3 p-4">
              <span className="min-w-0 flex-1">
                <span className={`${styles.leadName} block truncate text-gray-900`}>{lead.kind === "favour" ? lead.name : lead.row.name}</span>
                {lead.kind === "favour" ? (
                  <span className="block text-[13px] text-gray-400">Review it for <span className="font-semibold text-amber-600">{lead.points} pts</span></span>
                ) : (
                  <span className={`${styles.leadLine} text-[13px] text-gray-400`}>{lead.row.line ?? host(lead.row.url)}</span>
                )}
              </span>
              <span className={`${styles.pill} ${lead.kind === "vote" && lead.row.mine ? "bg-gray-100 text-gray-400" : "bg-gray-900 text-white"}`}>
                {lead.kind === "favour" ? "Review" : voteWord(lead.row)}
              </span>
            </span>
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <p className={`${styles.group} px-4 text-gray-400`}>On FAVOUR</p>
          <ol>
            {rows.map((row, i) => (
              <Row
                key={row.id}
                icon={<Icon src={pictures[row.id]?.icon || pictures[row.id]?.url || null} name={row.name} hue={pictures[row.id]?.fallback?.hue} />}
                name={row.name}
                // "by" is shown only for a company Oscar checked. Anyone can post any link,
                // so an unchecked row says so and names no company.
                sub={<><span className="font-semibold text-amber-600">{row.points} pts</span>{" · "}{row.makerChecked ? `by ${row.company}` : "maker not checked"}</>}
                pill="Review"
                label={`Review ${row.name}`}
                last={i === rows.length - 1}
                onClick={() => onOpen?.(row.id)}
              />
            ))}
          </ol>
        </>
      )}

      {voteRows.length > 0 && (
        <>
          <p className={`${styles.group} px-4 text-gray-400`}>Vote{votesFrom ? ` · ${votesFrom}` : ""}</p>
          <ul>
            {voteRows.map((row, i) => (
              <Row
                key={row.id}
                icon={<Icon src={row.icon || row.image} name={row.name} />}
                name={row.name}
                sub={row.line ?? host(row.url)}
                pill={votingId === row.id ? "…" : voteWord(row)}
                pillOn={!row.mine}
                label={row.mine ? `You voted for ${row.name}` : `Vote for ${row.name}`}
                disabled={row.mine || votingId === row.id}
                last={i === voteRows.length - 1}
                onClick={() => onVote?.(row)}
              />
            ))}
          </ul>
        </>
      )}
      {voteProblem && <p role="alert" className={`${styles.note} px-4 text-sm text-red-600`}>{voteProblem}</p>}

      {launches.length > 0 && (
        <>
          <p className={`${styles.group} px-4 text-gray-400`}>New on {source}</p>
          <ul>
            {launches.map((l, i) => (
              <Row
                key={l.id}
                icon={<Icon src={pictures[l.id]?.icon || null} name={l.name} hue={pictures[l.id]?.fallback?.hue} />}
                name={l.name}
                // The number is the source's, and the group names the source.
                sub={`${l.score} points · ${l.line ?? host(l.url)}`}
                pill="Open"
                label={`Open ${l.name}`}
                last={i === launches.length - 1}
                onClick={() => onOpenLaunch?.(l)}
              />
            ))}
          </ul>
        </>
      )}

      {/* The second door (Oscar, 8 Oct 2026: "someone should post their own app"). */}
      <div className="px-4">
        <button type="button" className={`${styles.post} min-h-[44px] w-full rounded-full bg-gray-100 text-[15px] font-semibold text-gray-900 active:scale-[0.98]`} onClick={onPost}>
          Post your own app
        </button>
      </div>
    </section>
  );
}
