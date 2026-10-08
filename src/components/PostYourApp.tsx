"use client";

import { useState } from "react";
import Link from "next/link";
import { MIN_BRIEF_WORDS, briefWords } from "@/lib/campaign-draft-shape";
import { campaignPicture } from "@/lib/campaign-picture";
import { ASK_MAX, POST_POINTS, POST_REVIEWS, postReason, postUrlOrNull } from "@/lib/post-app";
import type { ProductProposal } from "@/lib/product-fetch";
import styles from "./PostYourApp.module.css";

// POST YOUR OWN APP (Oscar, 8 Oct 2026). DESIGN-SYSTEM.md, Flow 2, on one route.
//
//   1. link     paste the link. One button: "Read my page".
//   2. confirm  FAVOUR shows what it read: name, line, picture. The maker changes
//               the name if it is wrong, adds a picture link if the page has
//               none, and writes the ask. One button: "Post for reviews".
//   3. done     the app is on FAVOUR. One button: back to the board.
//
// Two taps from here to done. The maker sees the name, the line and the picture
// before posting. The server reads the page once more when it posts, and stores
// what the page declares at that moment; if that read finds no picture, the
// maker is asked for a link to one.
// The reward is points and the screen says so; no money is named, because no
// campaign is funded here. A caller who is not signed in with a World wallet is
// told to open FAVOUR in World App; this screen does not rebuild sign-in.

type Step = "link" | "confirm" | "done";
type Problem = { text: string; openInWorldApp: boolean } | null;

async function send(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, data: { error: "FAVOUR could not be reached. Check your connection and try again." } };
  }
}

function problemOf(data: Record<string, unknown>): Problem {
  const code = data.code;
  return {
    text: typeof data.error === "string" ? data.error : "Something went wrong. Try again.",
    openInWorldApp: code === "reauth_required" || code === "wallet_required",
  };
}

export function PostYourApp() {
  const [step, setStep] = useState<Step>("link");
  const [link, setLink] = useState("");
  const [read, setRead] = useState<ProductProposal | null>(null);
  const [name, setName] = useState("");
  const [ask, setAsk] = useState("");
  const [makerImage, setMakerImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [askPicture, setAskPicture] = useState(false);

  const picture = campaignPicture({
    productName: name, productUrl: read?.url ?? link,
    makerImage: makerImage || null, shareImage: read?.image, icon: read?.icon,
  });
  const input = { productUrl: read?.url ?? link, productName: name, ask, makerImage: makerImage || undefined };
  const words = briefWords(ask);
  const notYet = step === "confirm" ? postReason(input, picture) : null;

  async function readPage() {
    if (!postUrlOrNull(link)) { setProblem({ text: "Paste a link to your app. It must start with https.", openInWorldApp: false }); return; }
    setBusy(true); setProblem(null);
    const { ok, data } = await send("/api/post-app/read", { url: link });
    setBusy(false);
    if (!ok) { setProblem(problemOf(data)); return; }
    const proposal = data.proposal as ProductProposal;
    setRead(proposal); setName(proposal.name ?? ""); setStep("confirm");
    window.scrollTo(0, 0);
  }

  async function publish() {
    if (notYet) { setProblem({ text: notYet, openInWorldApp: false }); return; }
    setBusy(true); setProblem(null);
    const { ok, data } = await send("/api/post-app", input);
    setBusy(false);
    if (!ok) {
      // The server reads the page again. If it found no picture, the field appears.
      if (data.code === "picture_required") setAskPicture(true);
      setProblem(problemOf(data));
      return;
    }
    setStep("done");
    window.scrollTo(0, 0);
  }

  return (
    <main className="mx-auto min-h-screen max-w-md bg-gray-50 px-4 pb-28 pt-3 text-gray-900">
      <Link href="/" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-gray-900 underline underline-offset-2">Back</Link>

      {step === "link" && (
        <section>
          <h1 className={styles.title}>Post your own app</h1>
          <p className="mt-1 text-sm text-gray-600">Paste the link. People try it and tell you what they think.</p>
          <label className="mt-5 block text-xs font-semibold text-gray-600" htmlFor="post-link">Link to your app</label>
          <input
            id="post-link" type="url" inputMode="url" autoComplete="url" placeholder="https://"
            value={link} onChange={(e) => setLink(e.target.value)} disabled={busy}
            className={`${styles.field} min-h-[48px] w-full rounded-xl border border-gray-200 bg-white text-[16px] text-gray-900`}
          />
          <button type="button" onClick={readPage} disabled={busy}
            className={`${styles.action} min-h-[44px] w-full rounded-xl bg-gray-900 px-5 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-60`}>
            {busy ? "Reading your page…" : "Read my page"}
          </button>
        </section>
      )}

      {step === "confirm" && read && (
        <section>
          <h1 className={styles.title}>Is this your app?</h1>
          <p className="mt-1 text-sm text-gray-600">FAVOUR read this from your page. Change what is wrong.</p>

          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {picture.url ? (
              // The maker's own picture, from the maker's own server. No referrer is sent.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={picture.url} alt={`${name}: ${picture.credit.toLowerCase()}`} referrerPolicy="no-referrer" className={styles.picture} />
            ) : (
              <p className="px-4 py-6 text-sm text-gray-600">Your page declares no picture. Add a link to one below.</p>
            )}
            <div className="px-4 py-3">
              {read.line && <p className="text-sm text-gray-600">{read.line}</p>}
              <p className="mt-1 text-xs text-gray-400">{picture.credit}</p>
            </div>
          </div>

          <label className="mt-4 block text-xs font-semibold text-gray-600" htmlFor="post-name">Name</label>
          <input id="post-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={busy}
            className={`${styles.field} min-h-[48px] w-full rounded-xl border border-gray-200 bg-white text-[16px] text-gray-900`} />

          {(!read.image || askPicture) && (
            <>
              <label className="mt-4 block text-xs font-semibold text-gray-600" htmlFor="post-picture">Link to a picture of your app</label>
              <input id="post-picture" type="url" inputMode="url" placeholder="https://" value={makerImage} onChange={(e) => setMakerImage(e.target.value)} disabled={busy}
                className={`${styles.field} min-h-[48px] w-full rounded-xl border border-gray-200 bg-white text-[16px] text-gray-900`} />
            </>
          )}

          <label className="mt-4 block text-xs font-semibold text-gray-600" htmlFor="post-ask">What should people try, and what do you want to know?</label>
          <textarea id="post-ask" value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={ASK_MAX} rows={5} disabled={busy}
            className={`${styles.field} ${styles.area} w-full rounded-xl border border-gray-200 bg-white text-[16px] text-gray-900`} />
          <p className="mt-1 text-xs text-gray-400 tabular-nums">
            {words < MIN_BRIEF_WORDS ? `${words} of ${MIN_BRIEF_WORDS} words` : `${words} words`}
          </p>

          <p className="mt-4 text-sm text-gray-600">
            You ask for {POST_REVIEWS} reviews. Each accepted review earns <span className="font-semibold text-amber-600">{POST_POINTS} pts</span>. No money moves.
          </p>
          <button type="button" onClick={publish} disabled={busy}
            className={`${styles.action} min-h-[44px] w-full rounded-xl bg-gray-900 px-5 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-60`}>
            {busy ? "Posting…" : "Post for reviews"}
          </button>
        </section>
      )}

      {step === "done" && (
        <section>
          <h1 className={styles.title}>{name} is on FAVOUR</h1>
          <p className="mt-1 text-sm text-gray-600">
            People can review it now, for {POST_POINTS} pts each.
          </p>
          <Link href="/" className="mt-5 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-gray-900 px-5 text-sm font-semibold text-white active:scale-[0.98]">
            See it on the board
          </Link>
        </section>
      )}

      {problem && (
        <div role="alert" className="mt-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-red-600">
          {problem.text}
          {problem.openInWorldApp && (
            <Link href="/" className="mt-1 block font-semibold text-gray-900 underline underline-offset-2">Open FAVOUR and sign in</Link>
          )}
        </div>
      )}
    </main>
  );
}
