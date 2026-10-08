"use client";

import { useState, useEffect } from "react";
import type { CompanyAppealHistory } from "@/lib/company-appeal-shape";
import type { Task } from "@/lib/types";
import { rewardAmountLabel } from "@/lib/reward";
import type { Contribution } from "@/lib/completions";
import { getCampaign } from "@/lib/campaigns";
import { Button, Card, Counts, Group, Heading, Note, Screen } from "@/components/Kit";
import styles from "./history.module.css";

// HISTORY (8 Oct 2026 redesign): one word, three counts in one white card, then
// rows of results in one card shape. Platform totals live here, NOT on the
// profile (Oscar Jul 5: "history can have total paid out, total points").
// Only favours that pass showInHistory() are listed (the route filters).
type Stats = {
  users?: { total?: number; verified?: number; reached?: number };
  volume?: { paidOutUsdc?: number; pointsDistributed?: number };
};

const PAGE = 12;

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ONE CARD for every result on this page (2026-09-21). The badge is always
// top-right, text is clamped, an image is always the same height.
function ResultCard({
  description, badge, imageUrl, note, meta, mine,
}: {
  description: string;
  badge: string;
  imageUrl: string | null;
  note?: string | null;
  meta: string;
  mine?: boolean;
}) {
  return (
    <div className={`${styles.result} ${mine ? styles.resultMine : ""}`}>
      <div className={styles.resultHead}>
        <p className={styles.resultText}>{description}</p>
        <span className={styles.resultBadge}>{badge}</span>
      </div>
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Proof" className={styles.resultImage} loading="lazy" />
      )}
      {note && <p className={styles.resultNote}>{note}</p>}
      <p className={styles.resultMeta}>{meta}</p>
    </div>
  );
}

export default function HistoryPage() {
  const [responseCampaigns, setResponseCampaigns] = useState<Array<{ id: string; company: string; role: string; pieces: number; waiting: number }>>([]);
  const [responseError, setResponseError] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/me/company-responses", { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then((d) => { if (live) setResponseCampaigns(d.campaigns || []); })
      .catch((e) => { if (live) setResponseError(e.message); });
    return () => { live = false; };
  }, []);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  // The signed-in person's own results, from the session. Empty when signed out.
  const [reviews, setReviews] = useState<CompanyAppealHistory[]>([]);
  const [reviewError, setReviewError] = useState("");
  const [mine, setMine] = useState<Contribution[]>([]);
  // A first screenful, then more on request.
  const [shown, setShown] = useState(PAGE);
  const otherResults = mine.filter((c) => !reviews.some((r) => r.taskId === c.taskId && r.role === "contributor" && r.outcome === "cleared"));

  useEffect(() => {
    Promise.all([
      fetch("/api/me/company-reviews", { cache: "no-store" }).then(async (r) => {
        const d = await r.json(); if (!r.ok) throw new Error(d.error); setReviews(d.reviews || []);
      }).catch((e) => setReviewError(e.message || "Review history unavailable")),
      fetch("/api/history").then((r) => r.json()).then((d) => setTasks(d.tasks || [])),
      fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {}),
      fetch("/api/me/contributions", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setMine(Array.isArray(d?.contributions) ? d.contributions : []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  return (
    <Screen label="History">
      <Heading size="display">History</Heading>

      {/* Platform totals. Cached by the server; the points total covers closed favours only. */}
      <Card label="FAVOUR totals">
        <Counts items={[
          { n: Math.round(stats.volume?.paidOutUsdc ?? 0), label: "USDC paid out" },
          { n: Math.round(stats.volume?.pointsDistributed ?? 0), label: "points, closed favours" },
          { n: stats.users?.reached ?? stats.users?.verified ?? 0, label: "people reached" },
        ]} />
      </Card>

      {reviewError && <Note kind="error">{reviewError}</Note>}
      {reviews.length > 0 && (
        <section aria-label="Your company reviews">
          <Group>Company work</Group>
          {reviews.map((review) => (
            <article key={review.id} className={styles.result}>
              <p className={styles.resultMeta}>{review.company} · {review.role === "company" ? "Your campaign" : "Your contribution"}</p>
              <p className={styles.resultText}>{review.description}</p>
              <p className={styles.verdict}>{review.outcome === "pending" ? `Awaiting human review · ${review.votes.length}/3 judges · no reward yet` : review.outcome === "superseded" ? "Proof replaced or withdrawn · no points from this review" : review.outcome === "cleared" ? `Accepted by human jury · ${review.points} points` : "Not accepted by human jury · no points"}</p>
              <p className={styles.resultNote}>{review.note}</p>
              <details className={styles.details}><summary>AI flag and review reasons</summary>
                <p className={styles.resultMeta}>AI: {review.aiReason}</p>
                <ol className={styles.reasons}>{review.votes.map((vote, i) => <li key={i}>{vote.real ? "Accept" : "Decline"}: {vote.reason}</li>)}</ol>
              </details>
              {review.role === "company" && <a className={styles.link} href={`/companies/${review.campaignId}/review`}>Review evidence and decide</a>}
            </article>
          ))}
        </section>
      )}

      {responseError && <Note kind="error">{responseError}</Note>}
      {!!responseCampaigns.length && (
        <section aria-label="Your company responses">
          <Group>Your company responses</Group>
          {responseCampaigns.map((c) => (
            <a key={c.id} href={`/companies/${encodeURIComponent(c.id)}/${c.role === "company" ? "review" : "contributions"}`} className={styles.result}>
              <p className={styles.resultText}>{c.company}</p>
              <p className={styles.resultMeta}>{c.pieces} contributions · {c.waiting} awaiting a response</p>
            </a>
          ))}
        </section>
      )}

      {otherResults.length > 0 && (
        <section aria-label="Your results">
          <Group>Yours</Group>
          {otherResults.map((c) => (
            <div key={`${c.taskId}-${c.at}`}>
              <ResultCard
                description={c.description}
                badge={`+${c.points} pts`}
                imageUrl={c.proofImageUrl}
                note={c.proofNote}
                meta={`${c.campaignLabel ? `${c.campaignLabel} · ` : c.campaignId && getCampaign(c.campaignId) ? `${getCampaign(c.campaignId)!.name} · ` : ""}Passed ${timeAgo(c.at)}${c.recovered ? " · from the completion log" : ""}`}
                mine
              />
              {c.campaignId?.startsWith("draft_") && <a href={`/companies/${encodeURIComponent(c.campaignId)}/contributions`} className={styles.link}>See the company response</a>}
            </div>
          ))}
        </section>
      )}

      <Group>Across FAVOUR</Group>
      {loading ? (
        <Note kind="loading" quiet>Reading…</Note>
      ) : tasks.length === 0 ? (
        <Note quiet>No completed favour yet.</Note>
      ) : (
        <>
          {tasks.slice(0, shown).map((task) => (
            <ResultCard
              key={task.id}
              description={task.description}
              badge={rewardAmountLabel(task)}
              imageUrl={task.proofImageUrl}
              note={task.proofImageUrl ? null : task.proofNote}
              meta={`${task.location} · ${timeAgo(task.createdAt)}`}
            />
          ))}
          {shown < tasks.length && (
            <Button kind="quiet" wide onClick={() => setShown((n) => n + PAGE)}>Show more ({tasks.length - shown})</Button>
          )}
        </>
      )}
    </Screen>
  );
}
