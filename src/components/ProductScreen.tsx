"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, TopBar } from "@worldcoin/mini-apps-ui-kit-react";
import { REVIEW_MAX, REVIEW_MIN_WORDS, reviewOutcome, reviewReason, reviewWords, type ProductView, type ReviewOutcome } from "@/lib/product-view";
import type { AcceptedReview, ProjectView } from "@/lib/project-view";
import type { VoteRow } from "@/lib/product-votes";
import { Bar, Loader } from "@/components/Fill";
import { TalkPicture } from "@/components/TalkPicture";
import { Field } from "./Kit";
import talk from "./Talk.module.css";
import styles from "./ProductScreen.module.css";

// THE PROJECT PAGE, /p/<id>. DESIGN-SYSTEM.md, "Project page", "Feedback round",
// Flow 1 (steps 2 to 4) and Flow 3. One route serves every app in the rail:
// a product posted on FAVOUR, a vote candidate, or an outside launch. One read,
// /api/project/<id>, tells the kind. Redrawn 10 Oct 2026 in the language of the
// Favours tab: World's kit on a white page, black, white and gray, the fill-up.
//
//   product  back, the picture wide, the name, one line, where it is from.
//            For an app on FAVOUR, the feedback round card: the maker's ask, a
//            bar only when the campaign holds a target, "N reviews in", and the
//            accepted reviews as plain rows as far as the public list goes.
//            Then the one dark button, the next step: "Review · N pts", "Vote"
//            or "Open". A quiet "Talk" pill opens the room.
//   write    the review, in the person's words, or a link to it. "Send for check".
//   result   accepted: the points, large. Not accepted: the reason, and the way
//            back to change it. Held: said plainly, nothing to resend.
//
// The check is the existing route, /api/verify-proof, through `sendReview`,
// which is unchanged: it reads the session and refuses a review sent as
// somebody else. A vote is the existing POST to /api/votes. No money is named:
// no campaign posted this way is funded. A vote count is drawn only when the
// server gave one.

type Load = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; project: ProjectView };
type Step = "product" | "write" | "result";
type Problem = Extract<ReviewOutcome, { kind: "problem" }>;
type Votes = { signedIn: boolean; mine: boolean };

async function sendReview(taskId: string, review: string): Promise<ReviewOutcome> {
  try {
    const session = await fetch("/api/session", { cache: "no-store" }).then((r) => r.json());
    if (!session?.authenticated || typeof session.address !== "string") return reviewOutcome(401, {});
    const res = await fetch("/api/verify-proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, submitter: session.address, proofNote: review, proofImages: [] }),
    });
    return reviewOutcome(res.status, await res.json().catch(() => ({})));
  } catch {
    return { kind: "problem", text: "FAVOUR could not be reached. Your review was not sent. Try again.", signIn: false, again: true };
  }
}

/** Where the app is from, as one caption. */
export function fromLine(p: ProjectView): string {
  if (p.kind === "launch") return `From ${p.source} · ${p.score} points · ${p.host}`;
  if (p.kind === "vote") return `Vote list · ${p.host}${p.votes !== null ? ` · ${p.votes} ${p.votes === 1 ? "vote" : "votes"}` : ""}`;
  const by = p.product.makerChecked ? ` · by ${p.product.company}` : "";
  return `Posted on FAVOUR · ${p.product.host}${by}`;
}

const KIND_WORD: Record<string, string> = { review: "Review", ugc: "Post", article: "Article" };

function ReviewRow({ r }: { r: AcceptedReview }) {
  const when = new Date(r.at);
  return (
    <li className={styles.reviewRow}>
      <span className={styles.reviewWho}>{r.participant}</span>
      <span className={styles.reviewWhat}>{r.kind ? KIND_WORD[r.kind] ?? r.kind : "Accepted"}</span>
      {Number.isFinite(when.getTime()) && <time dateTime={r.at} className={styles.reviewAt}>{when.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</time>}
    </li>
  );
}

function Back({ onBack }: { onBack?: () => void }) {
  const chevron = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>;
  if (onBack) {
    return <Button variant="tertiary" size="icon" className="min-h-[44px]" onClick={onBack} aria-label="Back">{chevron}</Button>;
  }
  return (
    <Link href="/" aria-label="Back" className={`min-h-[44px] ${talk.frameLink}`}>
      <Button variant="tertiary" size="icon" className="min-h-[44px]" asChild><span>{chevron}</span></Button>
    </Link>
  );
}

export function ProductScreen({ id }: { id: string }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<Step>("product");
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [outcome, setOutcome] = useState<Exclude<ReviewOutcome, Problem> | null>(null);
  // A vote: "mine" is private and comes from /api/votes; the count from the project.
  const [votes, setVotes] = useState<Votes | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [voting, setVoting] = useState(false);
  const [voteProblem, setVoteProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/project/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 404) return { kind: "missing" } as Load;
        const data = await res.json();
        if (!res.ok || !data?.project?.kind) throw new Error("unreadable");
        return { kind: "ready", project: data.project as ProjectView } as Load;
      })
      .then((next) => {
        if (!live) return;
        setLoad(next);
        if (next.kind === "ready" && next.project.kind === "vote") {
          setCount(next.project.votes);
          fetch("/api/votes", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((v) => {
            if (!live || !v || !Array.isArray(v.rows)) return;
            const row = (v.rows as VoteRow[]).find((r) => r.id === id);
            setVotes({ signedIn: !!v.signedIn, mine: !!row?.mine });
          }).catch(() => {});
        }
      })
      .catch(() => { if (live) setLoad({ kind: "error" }); });
    return () => { live = false; };
  }, [id, attempt]);

  const go = (next: Step) => { setProblem(null); setStep(next); window.scrollTo(0, 0); };

  async function send(product: ProductView) {
    const notYet = reviewReason(review);
    if (notYet) { setProblem({ kind: "problem", text: notYet, signIn: false, again: false }); return; }
    if (!product.reviewTaskId) return;
    setBusy(true); setProblem(null);
    const result = await sendReview(product.reviewTaskId, review.trim());
    setBusy(false);
    if (result.kind === "problem") { setProblem(result); return; }
    setOutcome(result); go("result");
    // A passed review is today's stamp on the hunt card. The server checks the
    // claim against the person's own record before it writes anything, and a
    // stamp that fails changes nothing here: the review stands on its own.
    if (result.kind === "passed") {
      fetch("/api/hunt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "review", id }) }).catch(() => {});
    }
  }

  // The existing vote call (the same POST the first tab makes); the server's count comes back.
  async function vote() {
    if (voting || votes?.mine) return;
    if (!votes?.signedIn) { setVoteProblem("Open FAVOUR in World App and sign in to vote."); return; }
    setVoting(true); setVoteProblem(null);
    try {
      const res = await fetch("/api/votes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.votes !== "number") { setVoteProblem(typeof data.error === "string" ? data.error : "Your vote was not saved. Try again."); return; }
      setCount(data.votes);
      setVotes({ signedIn: true, mine: true });
    } catch {
      setVoteProblem("FAVOUR could not be reached. Your vote was not saved.");
    } finally {
      setVoting(false);
    }
  }

  const project = load.kind === "ready" ? load.project : null;
  const product = project?.kind === "favour" ? project.product : null;
  const words = reviewWords(review);
  const name = project ? (project.kind === "favour" ? project.product.name : project.name) : "";
  const url = project ? (project.kind === "favour" ? project.product.productUrl : project.url) : "";
  const host = project ? (project.kind === "favour" ? project.product.host : project.host) : "";
  const picture = project ? (project.kind === "favour" ? project.product.picture : project.picture) : null;
  const line = project ? (project.kind === "favour" ? project.product.line : project.line) : null;
  const talkPill = <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={() => router.push(`/talk/${encodeURIComponent(id)}`)} aria-label={`Talk about ${name}`}>Talk</Button>;
  const sitePill = (
    <Button variant="tertiary" size="sm" className="min-h-[44px]" asChild>
      <a href={url} target="_blank" rel="noopener noreferrer nofollow">Open {host}</a>
    </Button>
  );

  return (
    <div className={talk.screen} aria-label="Project">
      {/* Back from a result goes to the product, never to the text: a passed review
          must not be sent twice, and "Change my review" is the way back for a refused one. */}
      <TopBar startAdornment={<Back onBack={step === "product" ? undefined : () => go("product")} />} title={step === "product" ? "" : name} />
      <div className={styles.body}>
        {load.kind === "loading" && <Loader label="Reading this app" />}

        {load.kind === "missing" && (
          <section aria-label="Not on FAVOUR">
            <h1 className={styles.heading}>This app is not on FAVOUR</h1>
            <p className={styles.line}>It was removed, or the link is wrong.</p>
            <div className={styles.primary}>
              <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" onClick={() => router.push("/")}>See today&apos;s apps</Button>
            </div>
          </section>
        )}

        {load.kind === "error" && (
          <section aria-label="Could not read">
            <p className={styles.line}>This app could not be read.</p>
            <div className={styles.action}>
              <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={() => { setLoad({ kind: "loading" }); setAttempt((n) => n + 1); }}>Try again</Button>
            </div>
          </section>
        )}

        {project && picture && step === "product" && (
          <section aria-label={name}>
            <TalkPicture name={name} url={picture.url} icon={picture.icon} colour={null} shape="cover" />
            <h1 className={styles.title}>{name}</h1>
            {line && <p className={styles.line}>{line}</p>}
            <p className={styles.from}>{fromLine(project)}</p>

            {project.kind === "favour" && (
              <section className={styles.card} aria-label="Feedback round">
                <p className={styles.eyebrow}>Feedback round</p>
                <p className={styles.ask}>{project.round.ask}</p>
                {project.round.target !== null ? (
                  <Bar done={Math.min(project.round.accepted, project.round.target)} of={project.round.target} label={project.round.progress} />
                ) : (
                  <p className={styles.progress}>{project.round.progress}</p>
                )}
                {project.round.reviews.length > 0 ? (
                  <ul className={styles.reviews} aria-label="Accepted reviews">
                    {project.round.reviews.map((r, i) => <ReviewRow key={`${r.participant}-${r.at}-${i}`} r={r} />)}
                  </ul>
                ) : (
                  <p className={styles.empty}>No review in yet. Be the first.</p>
                )}
              </section>
            )}

            {product && !product.reviewTaskId && <p className={styles.quiet}>This product takes no review now.</p>}

            <div className={styles.primary}>
              {product && product.reviewTaskId ? (
                <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" onClick={() => go("write")} aria-label={`Review ${name} for ${product.points} points`}>Review · {product.points} pts</Button>
              ) : project.kind === "vote" ? (
                <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" disabled={!!votes?.mine || voting} onClick={vote} aria-label={votes?.mine ? `You voted for ${name}` : `Vote for ${name}`}>
                  {voting ? "…" : votes?.mine ? (count === null ? "Voted" : `Voted · ${count}`) : "Vote"}
                </Button>
              ) : (
                <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" asChild>
                  <a href={url} target="_blank" rel="noopener noreferrer nofollow">Open</a>
                </Button>
              )}
            </div>
            {voteProblem && <p role="alert" className={styles.problem}>{voteProblem}</p>}
            <div className={styles.pills}>
              {talkPill}
              {(project.kind === "favour" || project.kind === "vote") && sitePill}
            </div>
          </section>
        )}

        {product && step === "write" && (
          <section aria-label="Your review">
            <h1 className={styles.heading}>Your review</h1>
            <p className={styles.line}>Try it first. Say what worked and what did not.</p>
            <div className={styles.pills}>{sitePill}</div>
            <div className={styles.field}>
              <Field
                id="product-review" label="Your review, or a link to it" area rows={7}
                value={review} onChange={(v) => { setReview(v); setProblem(null); }} maxLength={REVIEW_MAX} disabled={busy}
                count={words < REVIEW_MIN_WORDS ? `${words} of ${REVIEW_MIN_WORDS} words` : `${words} words`}
              />
            </div>
            <div className={styles.primary}>
              <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" onClick={() => send(product)} disabled={busy}>{busy ? "Checking your review…" : "Send for check"}</Button>
            </div>
          </section>
        )}

        {product && step === "result" && outcome?.kind === "passed" && (
          <section aria-label="Accepted">
            <h1 className={styles.heading}>Accepted</h1>
            {outcome.points !== null ? (
              <p className={styles.won} aria-label={`${outcome.points} points`}>+{outcome.points} pts</p>
            ) : (
              <p className={styles.quiet}>Your points are in History.</p>
            )}
            <p className={styles.line}>Your review of {name} is with the maker.</p>
            <div className={styles.primary}>
              <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" onClick={() => router.push("/")}>Review another app</Button>
            </div>
          </section>
        )}

        {product && step === "result" && outcome?.kind === "not_passed" && (
          <section aria-label="Not accepted">
            <h1 className={styles.heading}>Not accepted</h1>
            <div className={styles.card}><p className={styles.ask}>{outcome.reason}</p></div>
            <p className={styles.line}>Your text is kept. Change it and send it again.</p>
            <div className={styles.primary}>
              <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" onClick={() => go("write")}>Change my review</Button>
            </div>
          </section>
        )}

        {product && step === "result" && outcome?.kind === "held" && (
          <section aria-label="Held">
            <h1 className={styles.heading}>Held for a second look</h1>
            <div className={styles.card}><p className={styles.ask}>{outcome.reason}</p></div>
            <p className={styles.line}>Your review is saved and waits for a second check. Do not send it again.</p>
            <div className={styles.primary}>
              <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" onClick={() => router.push("/")}>Review another app</Button>
            </div>
          </section>
        )}

        {problem && (
          <div role="alert" className={styles.problemBox}>
            <p className={styles.problem}>{problem.text}</p>
            {problem.signIn && (
              <div className={styles.action}>
                <Button variant="tertiary" size="sm" className="min-h-[44px]" onClick={() => router.push("/")}>Open FAVOUR and sign in</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
