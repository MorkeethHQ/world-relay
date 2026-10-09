"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from "@worldcoin/mini-apps-ui-kit-react";
import { contractLine, shortAddress, type FeedCard } from "@/lib/feed";
import { ProjectCard } from "@/components/ProjectCard";
import { TalkPicture } from "@/components/TalkPicture";
import styles from "./ProjectCard.module.css";

// THE MAIN FEED: the project cards under the hunt card on Today (Oscar, 9 Oct
// 2026: "favours to projects, review, fetch from hacker news, smart contracts
// there"). DESIGN-SYSTEM.md, "First tab". The cards come from /api/feed in the
// order lib/feed.ts gave them. One tap on a card's picture or name opens
// /p/<id>; "Review" goes there too; "Vote" is the existing vote call, which
// stamps the hunt; "Talk" opens the room. The contract line opens the kit's
// Drawer: one sentence on what the line means, the escrow contract's address
// shortened, and "View on explorer" to World Chain's explorer. A points favour
// says points are paid by FAVOUR after the check and no contract holds money.
// Empty: one designed card that says what to do next. Nothing here is made up.

const EXPLORER_ADDRESS = "https://worldscan.org/address";

export function ProjectFeed({ cards, stamps, voting = false, voteProblem = null, onVote }: {
  cards: FeedCard[];
  stamps: ReadonlySet<string>;
  voting?: boolean;
  voteProblem?: string | null;
  onVote: (card: FeedCard) => void;
}) {
  const router = useRouter();
  const [about, setAbout] = useState<FeedCard | null>(null);
  const open = (c: FeedCard) => router.push(`/p/${encodeURIComponent(c.id)}`);
  const contract = about?.contract ?? null;

  return (
    <section className={styles.feed} aria-label="Projects">
      <h2 className={styles.label}>Projects</h2>

      {cards.length === 0 && (
        <article className={styles.card} aria-label="No project yet">
          <span className={styles.emptyCover} aria-hidden="true">+</span>
          <span className={styles.name}><b className={styles.emptyName}>Your app here</b></span>
          <div className={styles.act}><span className={styles.cap}>Nothing to check yet. Post your own app below.</span></div>
        </article>
      )}

      {cards.map((c) => (
        <ProjectCard
          key={`${c.kind}:${c.id}`}
          card={c}
          stamped={!!c.stamp && stamps.has(c.stamp)}
          voting={voting}
          onOpen={open}
          onReview={open}
          onVote={onVote}
          onTalk={(x) => router.push(`/talk/${encodeURIComponent(x.id)}`)}
          onContract={setAbout}
        />
      ))}
      {voteProblem && <p role="alert" className={styles.problem}>{voteProblem}</p>}

      <Drawer open={about !== null} onOpenChange={(o) => { if (!o) setAbout(null); }} height="fit">
        <DrawerContent>
          <div className={styles.sheet}>
            <DrawerHeader><DrawerTitle>{contract ? contractLine(contract) : ""}</DrawerTitle></DrawerHeader>
            {about && contract && (
              <>
                <div className={styles.who}>
                  <TalkPicture name={about.name} url={about.picture.url} icon={about.picture.icon} colour={null} shape="square" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b>{about.name}</b>
                    <small>{contract.kind === "escrow" ? "Escrow on World Chain" : "Paid in points"}</small>
                  </span>
                </div>
                {contract.kind === "escrow" ? (
                  <>
                    <p className={styles.line}>The maker&apos;s deposit for this favour sits in the escrow contract on World Chain. The maker releases it when a review is accepted. After the deadline it can be refunded to the maker.</p>
                    {contract.address && (
                      <div className={styles.kvs}>
                        <div className={styles.kv}><span>Contract</span><b>{shortAddress(contract.address)}</b></div>
                        <a className={`min-h-[44px] ${styles.kv} ${styles.kvLink}`} href={`${EXPLORER_ADDRESS}/${contract.address}`} target="_blank" rel="noopener noreferrer">
                          <span>View on explorer</span><i aria-hidden="true">›</i>
                        </a>
                      </div>
                    )}
                  </>
                ) : (
                  <p className={styles.line}>Points are paid by FAVOUR after the check. No contract holds money for this favour.</p>
                )}
              </>
            )}
            <div className={styles.sheetActions}>
              <DrawerClose asChild><Button variant="tertiary" fullWidth className="min-h-[44px]">Close</Button></DrawerClose>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </section>
  );
}
