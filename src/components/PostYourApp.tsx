"use client";

import { useState } from "react";
import { MIN_BRIEF_WORDS, briefWords } from "@/lib/campaign-draft-shape";
import { campaignPicture } from "@/lib/campaign-picture";
import { ASK_MAX, POST_POINTS, POST_REVIEWS, postReason, postUrlOrNull } from "@/lib/post-app";
import type { ProductProposal } from "@/lib/product-fetch";
import { Button, Caption, Field, Heading, LeadCard, Note, Picture, Screen, TopBar } from "./Kit";
import styles from "./PostYourApp.module.css";

// POST YOUR OWN APP (Oscar, 8 Oct 2026). DESIGN-SYSTEM.md, Flow 2, on one route.
//
// THE CARD IS THE FLOW (8 Oct 2026 redesign, Oscar: "not very inspiring upload,
// take a full stab"). The maker sees their app as the lead card it will be on
// FAVOUR, on every step, drawn by the same `LeadCard` the first page uses:
//
//   1. link     the card is an empty frame that says where the app will appear.
//               Paste the link. One button: "Show my app".
//   2. confirm  the card fills with what FAVOUR read: picture, name, line, and
//               the pill "Review · 10 pts". The name is edited under it and the
//               card follows. A picture link is asked for only when the page has
//               none. Then the ask. One button: "Post for reviews".
//   3. done     the same card with the pill "On FAVOUR". One button: see it on
//               the first page. A quiet pill posts another.
//
// Two taps from here to done. Nothing is published that the maker did not see.
// The server reads the page once more when it posts, and stores what the page
// declares at that moment; if that read finds no picture, the maker is asked
// for a link to one. The reward is points and the screen says so; no money is
// named, because no campaign is funded here. A caller who is not signed in with
// a World wallet is told to open FAVOUR in World App; this screen does not
// rebuild sign-in.

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

const hostOf = (url: string): string | null => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; } };

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
  const typedHost = postUrlOrNull(link) ? hostOf(link) : null;

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

  function startOver() {
    setStep("link"); setLink(""); setRead(null); setName(""); setAsk(""); setMakerImage(""); setProblem(null); setAskPicture(false);
    window.scrollTo(0, 0);
  }

  // The card: the maker's app as it will be on FAVOUR. The name on it is the
  // name in the field, so an edit shows at once.
  const shownName = name.trim() || read?.name || typedHost || "Your app";
  const card = step === "link" ? (
    <LeadCard
      empty={typedHost ? `${typedHost} will appear here` : "Your app will appear here, with its own picture"}
      picture={null}
      name={typedHost ?? "Your app"}
      line={typedHost ? "Read from your page when you tap the button" : "Its name, its line and its picture, from your page"}
      pill={null}
      label="Where your app will appear"
    />
  ) : (
    <LeadCard
      picture={<Picture wide src={picture.url} name={shownName} initial={picture.fallback?.initial} hue={picture.fallback?.hue} alt={picture.url ? `${shownName}: ${picture.credit.toLowerCase()}` : ""} />}
      name={shownName}
      line={step === "done"
        ? <>People can review it now, for <span className="font-semibold text-amber-600">{POST_POINTS} pts</span> each</>
        : <>Review it for <span className="font-semibold text-amber-600">{POST_POINTS} pts</span></>}
      // The pill on the preview is grey: the one dark button on this screen is
      // the next step, under the form. On the first page the same card is dark.
      pill={step === "done" ? "On FAVOUR" : "Review"}
      pillTone="on"
      label={step === "done" ? `${shownName} is on FAVOUR` : `${shownName}, as it will look on FAVOUR`}
    />
  );

  return (
    <Screen label="Post your own app">
      <TopBar back="/" />

      {step === "link" && (
        <section>
          <Heading size="title" line="Paste the link. See your app as people will.">Post your own app</Heading>
          <Field id="post-link" label="Link to your app" type="url" inputMode="url" autoComplete="url" placeholder="https://" value={link} onChange={(v) => { setLink(v); setProblem(null); }} disabled={busy} />
          {card}
          <Button onClick={readPage} disabled={busy}>{busy ? "Reading your page…" : "Show my app"}</Button>
        </section>
      )}

      {step === "confirm" && read && (
        <section>
          <Heading size="title" line="This is how it looks on FAVOUR. Change what is wrong.">Is this your app?</Heading>
          {card}
          <Caption>{picture.url ? picture.credit : "Your page declares no picture. Add a link to one below."}</Caption>

          <Field id="post-name" label="Name" value={name} onChange={setName} maxLength={80} disabled={busy} />

          {/* The field shows whenever the card has no picture to show, not only when
              the page declared none: a declared picture the rules refuse would
              otherwise block the post with no way to add one. */}
          {(!picture.url || askPicture) && (
            <Field id="post-picture" label="Link to a picture of your app" type="url" inputMode="url" placeholder="https://" value={makerImage} onChange={setMakerImage} disabled={busy} />
          )}

          <Field
            id="post-ask" label="What should people try, and what do you want to know?" area rows={5}
            value={ask} onChange={setAsk} maxLength={ASK_MAX} disabled={busy}
            placeholder="Open it, try the main thing, and tell me…"
            count={words < MIN_BRIEF_WORDS ? `${words} of ${MIN_BRIEF_WORDS} words` : `${words} words`}
          />

          <p className={styles.terms}>
            {POST_REVIEWS} reviews. <span className="font-semibold text-amber-600">{POST_POINTS} pts</span> each, paid by FAVOUR. No money moves.
          </p>
          <Button onClick={publish} disabled={busy}>{busy ? "Posting…" : "Post for reviews"}</Button>
        </section>
      )}

      {step === "done" && (
        <section>
          <Heading size="title" line="People can review it now.">{shownName} is on FAVOUR</Heading>
          {card}
          <Button href="/">See it on the first page</Button>
          <Button kind="quiet" wide onClick={startOver}>Post another app</Button>
        </section>
      )}

      {problem && (
        <Note kind="error">
          {problem.text}
          {problem.openInWorldApp && <Button kind="quiet" wide href="/">Open FAVOUR and sign in</Button>}
        </Note>
      )}
    </Screen>
  );
}
