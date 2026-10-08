"use client";

import type { CampaignPicture } from "@/lib/campaign-picture";
import type { Launch } from "@/lib/launch-feed";
import type { VoteRow } from "@/lib/product-votes";
import type { TopList } from "@/lib/rank-campaigns";
import { Button, Group, LeadCard, Picture, Row } from "./Kit";
import styles from "./TopProducts.module.css";

// THE FIRST THING ON THE FIRST PAGE (Oscar, 8 Oct 2026). Products, and nothing
// else: "TOP today needs to be products for sure".
//
// ONE PIECE, ONE ROW, drawn with the one kit (8 Oct 2026 redesign):
//   - one word, "Today"
//   - one lead card: one product, its picture first
//   - one kind of row for everything else: a picture, a name, one line, one pill
//   - one door at the end: "Post your own app"
// The only dark pill is on the lead card. Every pill in a row is grey.
//
// Three groups, never mixed, because their numbers mean different things:
//   On FAVOUR          a maker posted it. It can be reviewed for points.
//   Vote               real products a person can vote for. A vote pays nothing.
//   New on Hacker News an outside launch list. The points are Hacker News's.
// A group with nothing in it is not drawn. No sentence explains an empty group.
// A product to vote for that is already on FAVOUR is not listed twice: its row
// on FAVOUR is the one that pays.
//
// Honest numbers: a count is shown only when the server gave one. Points are
// amber. No money shows here: a proposed pool is not money.

type Lead =
  | { kind: "favour"; id: string; name: string; picture: string; points: number }
  | { kind: "vote"; row: VoteRow; picture: string };

// A stored link may be malformed; that must not take the first page down.
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
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
  const onFavour = new Set(top.rows.map((r) => (r.productUrl ? host(r.productUrl) : "")).filter(Boolean));
  const candidates = votes.filter((v) => !onFavour.has(v.host));

  // The lead is the first product with a picture: one on FAVOUR first, since it
  // can be reviewed now, then one to vote for. No picture, no lead card.
  const first = top.rows.find((r) => pictures[r.id]?.url);
  const firstVote = first ? undefined : candidates.find((v) => v.image);
  const lead: Lead | null = first
    ? { kind: "favour", id: first.id, name: first.name, picture: pictures[first.id].url!, points: first.points }
    : firstVote ? { kind: "vote", row: firstVote, picture: firstVote.image! } : null;
  const rows = top.rows.filter((r) => !(lead?.kind === "favour" && lead.id === r.id));
  const voteRows = candidates.filter((v) => !(lead?.kind === "vote" && lead.row.id === v.id));
  const source = launches[0]?.source;

  return (
    <section aria-label="Products today" className={styles.wrap}>
      <h2 className={styles.heading}>Today</h2>

      {lead && (
        <LeadCard
          picture={<Picture wide src={lead.picture} name={lead.kind === "favour" ? lead.name : lead.row.name} />}
          name={lead.kind === "favour" ? lead.name : lead.row.name}
          line={lead.kind === "favour"
            ? <>Review it for <span className="font-semibold text-amber-600">{lead.points} pts</span></>
            : (lead.row.line ?? host(lead.row.url))}
          pill={lead.kind === "favour" ? "Review" : voteWord(lead.row)}
          pillTone={lead.kind === "vote" && lead.row.mine ? "off" : "dark"}
          label={lead.kind === "favour" ? `Review ${lead.name}` : lead.row.mine ? `You voted for ${lead.row.name}` : `Vote for ${lead.row.name}`}
          onClick={() => (lead.kind === "favour" ? onOpen?.(lead.id) : onVote?.(lead.row))}
          disabled={lead.kind === "vote" && (lead.row.mine || votingId === lead.row.id)}
        />
      )}

      {rows.length > 0 && (
        <>
          <Group>On FAVOUR</Group>
          <ol>
            {rows.map((row, i) => (
              <Row
                key={row.id}
                picture={<Picture src={pictures[row.id]?.icon || pictures[row.id]?.url || null} name={row.name} hue={pictures[row.id]?.fallback?.hue} />}
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
          <Group>Vote{votesFrom ? ` · ${votesFrom}` : ""}</Group>
          <ul>
            {voteRows.map((row, i) => (
              <Row
                key={row.id}
                picture={<Picture src={row.icon || row.image} name={row.name} />}
                name={row.name}
                sub={row.line ?? host(row.url)}
                pill={votingId === row.id ? "…" : voteWord(row)}
                pillTone={row.mine ? "off" : "on"}
                label={row.mine ? `You voted for ${row.name}` : `Vote for ${row.name}`}
                disabled={row.mine || votingId === row.id}
                last={i === voteRows.length - 1}
                onClick={() => onVote?.(row)}
              />
            ))}
          </ul>
        </>
      )}
      {voteProblem && <p role="alert" className={styles.problem}>{voteProblem}</p>}

      {launches.length > 0 && (
        <>
          <Group>New on {source}</Group>
          <ul>
            {launches.map((l, i) => (
              <Row
                key={l.id}
                picture={<Picture src={pictures[l.id]?.icon || null} name={l.name} hue={pictures[l.id]?.fallback?.hue} />}
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
      <div className={styles.door}>
        <Button kind="quiet" wide onClick={onPost}>Post your own app</Button>
      </div>
    </section>
  );
}
