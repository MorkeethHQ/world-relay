"use client";

import { useEffect, useState } from "react";
import { REVIEW_MAX, REVIEW_MIN_WORDS, reviewOutcome, reviewReason, reviewWords, type ProductView, type ReviewOutcome } from "@/lib/product-view";
import { Body, Button, Caption, Card, Field, Heading, Note, Picture, Screen, TopBar } from "./Kit";
import styles from "./ProductScreen.module.css";

// THE PRODUCT SCREEN. DESIGN-SYSTEM.md, Flow 1, steps 2 to 4, on one route, /p/<id>.
// Drawn with the one kit (8 Oct 2026 redesign).
//
//   1. product  the picture, the name, the line, who made it. A card with what
//               the maker asks. One line with the points and the count. One
//               button: "Write your review". A quiet pill opens the product.
//   2. write    the review, in the person's words, or a link to it. One button:
//               "Send for check".
//   3. result   accepted: the points, large, at once. Not accepted: the reason,
//               and the way back to change it. Held: said plainly, nothing to resend.
//
// Three taps from the first page to the result: the row, "Write your review",
// "Send for check". The reward is points and the screen says so. No money is
// named: no campaign posted this way is funded.
//
// The check is the existing route, /api/verify-proof. It reads the session and
// refuses a review sent as somebody else. A person who is not signed in is sent
// to FAVOUR to sign in; this screen does not rebuild sign-in.

type Load = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; product: ProductView };
type Step = "product" | "write" | "result";
type Problem = Extract<ReviewOutcome, { kind: "problem" }>;

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

export function ProductScreen({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<Step>("product");
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [outcome, setOutcome] = useState<Exclude<ReviewOutcome, Problem> | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/product/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.status === 404) return { kind: "missing" } as Load;
        const data = await res.json();
        if (!res.ok || !data?.product) throw new Error("unreadable");
        return { kind: "ready", product: data.product as ProductView } as Load;
      })
      .then((next) => { if (live) setLoad(next); })
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
  }

  const product = load.kind === "ready" ? load.product : null;
  const words = reviewWords(review);
  const site = product && (
    <a href={product.productUrl} target="_blank" rel="noopener noreferrer nofollow" className={styles.site}>Open {product.host}</a>
  );

  return (
    <Screen label="Product">
      {step === "product" ? <TopBar back="/" /> : <TopBar onBack={() => go(step === "write" ? "product" : "write")} title={product?.name} />}

      {load.kind === "loading" && <Note kind="loading" quiet>Reading this product…</Note>}

      {load.kind === "missing" && (
        <section>
          <Heading line="It was removed, or the link is wrong.">This product is not on FAVOUR</Heading>
          <Button href="/">See today&apos;s products</Button>
        </section>
      )}

      {load.kind === "error" && (
        <section>
          <Heading>This product could not be read</Heading>
          <Button onClick={() => { setLoad({ kind: "loading" }); setAttempt((n) => n + 1); }}>Try again</Button>
        </section>
      )}

      {product && step === "product" && (
        <section>
          <Picture wide framed src={product.picture.url} name={product.name} initial={product.picture.fallback?.initial} hue={product.picture.fallback?.hue} alt={product.picture.url ? `${product.name}: ${product.picture.credit.toLowerCase()}` : ""} />
          <Heading size="title" line={product.line ?? undefined}>{product.name}</Heading>
          <Caption>{product.makerChecked ? `by ${product.company}` : "maker not checked"}</Caption>
          <div className={styles.siteRow}>{site}</div>

          <Card label="The maker asks">
            <p className={styles.eyebrow}>The maker asks</p>
            <Body>{product.ask}</Body>
          </Card>

          <p className={styles.reward}>
            <span className="font-semibold text-amber-600">{product.points} pts</span> for an accepted review
            {" · "}<span className="tabular-nums">{product.accepted}{product.acceptedIsFloor ? "+" : ""}</span> accepted so far
          </p>
          {product.reviewTaskId ? (
            <Button onClick={() => go("write")}>Write your review</Button>
          ) : (
            <>
              <Note quiet>This product takes no review now.</Note>
              <Button href="/">See today&apos;s products</Button>
            </>
          )}
        </section>
      )}

      {product && step === "write" && (
        <section>
          <Heading line="Try it first. Say what worked and what did not.">Your review</Heading>
          <div className={styles.siteRow}>{site}</div>
          <Field
            id="product-review" label="Your review, or a link to it" area rows={7}
            value={review} onChange={(v) => { setReview(v); setProblem(null); }} maxLength={REVIEW_MAX} disabled={busy}
            count={words < REVIEW_MIN_WORDS ? `${words} of ${REVIEW_MIN_WORDS} words` : `${words} words`}
          />
          <Button onClick={() => send(product)} disabled={busy}>{busy ? "Checking your review…" : "Send for check"}</Button>
        </section>
      )}

      {product && step === "result" && outcome?.kind === "passed" && (
        <section>
          <Heading>Accepted</Heading>
          {outcome.points !== null ? (
            <p className={`${styles.won} text-amber-600`} aria-label={`${outcome.points} points`}>+{outcome.points} pts</p>
          ) : (
            <Note quiet>Your points are in History.</Note>
          )}
          <Caption>Your review of {product.name} is with the maker.</Caption>
          <Button href="/">Review another product</Button>
        </section>
      )}

      {product && step === "result" && outcome?.kind === "not_passed" && (
        <section>
          <Heading>Not accepted</Heading>
          <Card><Body>{outcome.reason}</Body></Card>
          <Caption>Your text is kept. Change it and send it again.</Caption>
          <Button onClick={() => go("write")}>Change my review</Button>
        </section>
      )}

      {product && step === "result" && outcome?.kind === "held" && (
        <section>
          <Heading>Held for a second look</Heading>
          <Card><Body>{outcome.reason}</Body></Card>
          <Caption>Your review is saved and waits for a second check. Do not send it again.</Caption>
          <Button href="/">Review another product</Button>
        </section>
      )}

      {problem && (
        <Note kind="error">
          {problem.text}
          {problem.signIn && <Button kind="quiet" wide href="/">Open FAVOUR and sign in</Button>}
        </Note>
      )}
    </Screen>
  );
}
