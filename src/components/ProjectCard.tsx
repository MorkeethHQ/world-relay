"use client";

import { Button, Chip } from "@worldcoin/mini-apps-ui-kit-react";
import { actionOf, contractLine, sourceText, type FeedCard } from "@/lib/feed";
import { TalkPicture } from "@/components/TalkPicture";
import styles from "./ProjectCard.module.css";

// ONE PROJECT CARD in the main feed (Oscar, 9 Oct 2026: "Project cards A for
// sure, beautiful", "only black though"). DESIGN-SYSTEM.md, "First tab".
// Top to bottom: the wide cover picture (none when the server gave no picture,
// so the card is shorter rather than an empty box), the small square picture
// with the name and the source chip, the maker's ask with the reward at its
// end, the 6px review bar with its label when the state is known, one quiet
// contract line with a chevron, and the one action. Every number and word
// comes from the card the server built (lib/feed.ts); nothing is made here.
// Black, white and gray only, the reward text included.

export function ProjectCard({ card, stamped, voting = false, onOpen, onReview, onVote, onTalk, onContract }: {
  card: FeedCard;
  stamped: boolean; // this wallet voted or sent an accepted review today
  voting?: boolean;
  onOpen: (card: FeedCard) => void; // the project page
  onReview: (card: FeedCard) => void;
  onVote: (card: FeedCard) => void;
  onTalk: (card: FeedCard) => void;
  onContract: (card: FeedCard) => void;
}) {
  const act = actionOf(card);
  const voted = card.kind === "vote" && (card.mine || stamped);
  const pill = (
    act?.kind === "review" ? (
      <Button variant="tertiary" size="sm" className="min-h-[44px]" disabled={stamped} onClick={() => onReview(card)} aria-label={stamped ? `${card.name}: checked today` : `${act.label}: ${card.name}`}>
        {stamped ? "Checked" : act.label}
      </Button>
    ) : act?.kind === "vote" ? (
      <Button variant="tertiary" size="sm" className="min-h-[44px]" disabled={voted || voting} onClick={() => onVote(card)} aria-label={voted ? `You voted for ${card.name}` : `Vote for ${card.name}`}>
        {voting ? "…" : voted ? (card.votes === null ? "Voted" : `Voted · ${card.votes}`) : "Vote"}
      </Button>
    ) : act?.kind === "talk" ? (
      <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={() => onTalk(card)} aria-label={`Talk about ${card.name}`}>Talk</Button>
    ) : null
  );
  const cap = stamped ? "Checked today" : card.kind === "vote" && typeof card.votes === "number" ? `${card.votes} ${card.votes === 1 ? "vote" : "votes"}` : card.favour ? null : "No favour yet";

  return (
    <article className={styles.card} aria-label={card.name}>
      <button type="button" className={`min-h-[44px] ${styles.open}`} onClick={() => onOpen(card)} aria-label={`${card.name}: open`}>
        {card.picture.url && (
          <span className={styles.cover}>
            <TalkPicture name={card.name} url={card.picture.url} icon={card.picture.icon} colour={null} shape="cover" />
          </span>
        )}
        <span className={styles.name}>
          <TalkPicture name={card.name} url={card.picture.url} icon={card.picture.icon} colour={null} shape="squareSmall" />
          <b>{card.name}</b>
          <Chip label={sourceText(card.source)} />
        </span>
      </button>

      {card.favour && (
        <div className={styles.ask}>
          <span>{card.favour.ask}</span>
          {card.favour.reward ? <b>{card.favour.reward}</b> : <i>Not funded yet</i>}
        </div>
      )}

      {card.review && (
        <div className={styles.review} aria-label={card.review.line}>
          {card.review.share !== null && (
            <span className={styles.track} aria-hidden="true"><span className={styles.fill} style={{ width: `${Math.round(card.review.share * 100)}%` }} /></span>
          )}
          <small>{card.review.line}</small>
        </div>
      )}

      {card.contract && (
        <button type="button" className={`min-h-[44px] ${styles.contract}`} onClick={() => onContract(card)} aria-label={`${contractLine(card.contract)}: what this means`}>
          {card.contract.kind === "escrow" ? <><b>{contractLine(card.contract).replace(" in escrow", "")}</b> in escrow</> : contractLine(card.contract)}
          <i aria-hidden="true">›</i>
        </button>
      )}

      {(cap || pill) && (
        <div className={styles.act}>
          {cap && <span className={styles.cap}>{cap}</span>}
          {pill}
        </div>
      )}
    </article>
  );
}
