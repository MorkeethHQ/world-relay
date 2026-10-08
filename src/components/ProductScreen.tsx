"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { REVIEW_MAX, REVIEW_MIN_WORDS, reviewOutcome, reviewReason, reviewWords, type ProductView, type ReviewOutcome } from "@/lib/product-view";
import styles from "./ProductScreen.module.css";

// THE PRODUCT SCREEN. DESIGN-SYSTEM.md, Flow 1, steps 2 to 4, on one route, /p/<id>.
//
//   1. product  the picture, what the maker asks, the reward. One button:
//               "Write your review". A link opens the product, to try it.
//   2. write    the review, in the person's words, or a link to it. One button:
//               "Send for check".
//   3. result   accepted: the points, at once. Not accepted: the reason, and the
//               way back to change it. Held: said plainly, nothing to resend.
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

const primary = "min-h-[44px] w-full rounded-xl bg-gray-900 px-5 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-60";
const quiet = "inline-flex min-h-[44px] items-center text-sm font-semibold text-gray-900 underline underline-offset-2";

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

  return (
    <main className="mx-auto min-h-screen max-w-md bg-gray-50 px-4 pb-28 pt-3 text-gray-900">
      <Link href="/" className={quiet}>Back</Link>

      {load.kind === "loading" && <p role="status" className="mt-6 text-sm text-gray-600">Reading this product…</p>}

      {load.kind === "missing" && (
        <section>
          <h1 className={styles.heading}>This product is not on FAVOUR</h1>
          <p className="mt-1 text-sm text-gray-600">It was removed, or the link is wrong.</p>
          <Link href="/" className={`${styles.action} ${primary}`}>See today&apos;s products</Link>
        </section>
      )}

      {load.kind === "error" && (
        <section role="alert">
          <h1 className={styles.heading}>This product could not be read</h1>
          <button type="button" className={`min-h-[44px] ${styles.action} ${primary}`} onClick={() => { setLoad({ kind: "loading" }); setAttempt((n) => n + 1); }}>
            Try again
          </button>
        </section>
      )}

      {product && step === "product" && (
        <section>
          {product.picture.url ? (
            // The product's own picture, from its own server. No referrer is sent.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.picture.url} alt={`${product.name}: ${product.picture.credit.toLowerCase()}`} referrerPolicy="no-referrer" className={styles.picture} />
          ) : (
            <div className={`${styles.picture} ${styles.initial}`} style={{ backgroundColor: `hsl(${product.picture.fallback?.hue ?? 0} 12% 92%)` }} aria-hidden="true">
              {product.picture.fallback?.initial ?? Array.from(product.name)[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <h1 className={styles.title}>{product.name}</h1>
          {product.line && <p className="mt-1 text-[15px] text-gray-600">{product.line}</p>}
          <p className="mt-1 text-xs text-gray-400">{product.makerChecked ? `by ${product.company}` : "maker not checked"}</p>
          <a href={product.productUrl} target="_blank" rel="noopener noreferrer nofollow" className={quiet}>Open {product.host}</a>

          <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold text-gray-600">The maker asks</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6 text-gray-900">{product.ask}</p>
          </div>

          <p className={`${styles.gap} text-sm text-gray-600`}>
            <span className="font-semibold text-amber-600">{product.points} pts</span> for an accepted review.{" "}
            <span className="tabular-nums">{product.accepted}{product.acceptedIsFloor ? "+" : ""}</span> accepted so far.
          </p>
          {product.reviewTaskId ? (
            <button type="button" className={`min-h-[44px] ${styles.action} ${primary}`} onClick={() => go("write")}>Write your review</button>
          ) : (
            <>
              <p className={`${styles.gap} text-sm text-gray-600`}>This product takes no review now.</p>
              <Link href="/" className={`${styles.action} ${primary}`}>See today&apos;s products</Link>
            </>
          )}
        </section>
      )}

      {product && step === "write" && (
        <section>
          <h1 className={styles.heading}>Your review of {product.name}</h1>
          <p className="mt-1 text-sm text-gray-600">Try it first. Say what worked and what did not.</p>
          <a href={product.productUrl} target="_blank" rel="noopener noreferrer nofollow" className={quiet}>Open {product.host}</a>
          <label className="mt-2 block text-xs font-semibold text-gray-600" htmlFor="product-review">Your review, or a link to it</label>
          <textarea
            id="product-review" value={review} onChange={(e) => { setReview(e.target.value); setProblem(null); }} maxLength={REVIEW_MAX} rows={7} disabled={busy}
            className={`${styles.area} w-full rounded-xl border border-gray-200 bg-white text-[16px] text-gray-900`}
          />
          <p className="mt-1 text-xs text-gray-400 tabular-nums">
            {words < REVIEW_MIN_WORDS ? `${words} of ${REVIEW_MIN_WORDS} words` : `${words} words`}
          </p>
          <button type="button" className={`min-h-[44px] ${styles.action} ${primary}`} onClick={() => send(product)} disabled={busy}>
            {busy ? "Checking your review…" : "Send for check"}
          </button>
        </section>
      )}

      {product && step === "result" && outcome?.kind === "passed" && (
        <section>
          <h1 className={styles.heading}>Accepted</h1>
          {outcome.points !== null ? (
            <p className={`${styles.won} tabular-nums text-amber-600`} aria-label={`${outcome.points} points`}>+{outcome.points} pts</p>
          ) : (
            <p className="mt-1 text-sm text-gray-600">Your points are in History.</p>
          )}
          <p className={`${styles.gap} text-sm text-gray-600`}>Your review of {product.name} is with the maker.</p>
          <Link href="/" className={`${styles.action} ${primary}`}>Review another product</Link>
        </section>
      )}

      {product && step === "result" && outcome?.kind === "not_passed" && (
        <section>
          <h1 className={styles.heading}>Not accepted</h1>
          <p className={`${styles.gapSmall} text-[15px] leading-6 text-gray-900`}>{outcome.reason}</p>
          <p className={`${styles.gapSmall} text-sm text-gray-600`}>Your text is kept. Change it and send it again.</p>
          <button type="button" className={`min-h-[44px] ${styles.action} ${primary}`} onClick={() => go("write")}>Change my review</button>
        </section>
      )}

      {product && step === "result" && outcome?.kind === "held" && (
        <section>
          <h1 className={styles.heading}>Held for a second look</h1>
          <p className={`${styles.gapSmall} text-[15px] leading-6 text-gray-900`}>{outcome.reason}</p>
          <p className={`${styles.gapSmall} text-sm text-gray-600`}>Your review is saved and waits for a second check. Do not send it again.</p>
          <Link href="/" className={`${styles.action} ${primary}`}>Review another product</Link>
        </section>
      )}

      {problem && (
        <div role="alert" className="mt-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-red-600">
          {problem.text}
          {problem.signIn && <Link href="/" className={`${quiet} mt-1 flex`}>Open FAVOUR and sign in</Link>}
        </div>
      )}
    </main>
  );
}
