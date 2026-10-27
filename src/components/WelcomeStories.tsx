"use client";

import { useState } from "react";
import type { WelcomeStepView, WelcomeView } from "@/lib/welcome-shape";
import { hasSavedStoryProof, storyArt, storyState } from "@/lib/welcome-stories";

export function StorySegments({ steps, active, signedIn, onChoose }: {
  steps: WelcomeStepView[]; active?: string; signedIn: boolean; onChoose?: (id: string) => void;
}) {
  return <div className="story-segments" role="group" aria-label="Campaign favours">
    {steps.map((s, i) => <button key={s.sourceTaskId} type="button"
      aria-label={`Favour ${i + 1}: ${storyArt(s.description).title}, ${storyState(s, signedIn)}`}
      aria-current={active === s.sourceTaskId ? "step" : undefined}
      data-accepted={signedIn && s.state === "done" ? "true" : undefined}
      disabled={!onChoose} onClick={() => onChoose?.(s.sourceTaskId)}><span /></button>)}
  </div>;
}

export function WelcomeStories({ welcome, signedIn, busyId, error, onStart, onBack, onDiscover }: {
  welcome: WelcomeView; signedIn: boolean; busyId: string | null; error: string | null;
  onStart: (step: WelcomeStepView) => void; onBack: () => void; onDiscover: () => void;
}) {
  const [selected, setSelected] = useState(() => {
    const saved = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("step");
    return welcome.steps.find((s) => s.sourceTaskId === saved)?.sourceTaskId
      ?? welcome.steps.find((s) => s.state === "todo")?.sourceTaskId ?? welcome.steps[0]?.sourceTaskId ?? null;
  });
  const index = Math.max(0, welcome.steps.findIndex((s) => s.sourceTaskId === selected));
  const step = welcome.steps[index];
  const done = signedIn ? welcome.steps.filter((s) => s.state === "done").length : 0;
  const waiting = signedIn ? welcome.steps.filter((s) => (s.state === "sent" && hasSavedStoryProof(s)) || s.state === "in_review").length : 0;
  function choose(id: string) {
    setSelected(id);
    const url = new URL(window.location.href); url.searchParams.set("campaign", "welcome"); url.searchParams.set("step", id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    document.getElementById("welcome-story")?.scrollIntoView({ behavior: "auto", block: "start" });
  }
  if (!step) return <div className="stories-page stories-empty"><button type="button" onClick={onBack}>← Campaigns</button><h1>{welcome.campaign.name}</h1><p>The favour list is being refreshed. No favours are available to start right now.</p></div>;
  const art = storyArt(step.description);
  return <div className="stories-page">
    <section id="welcome-story" className="story-frame" aria-label={`Favour ${index + 1} of ${welcome.steps.length}`}>
      {/* Existing editorial image, explicitly not a participant's submission. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="story-photo" src={art.image} alt="" aria-hidden="true" />
      <div className="story-scrim" />
      <div className="story-frame-inner">
        <div><StorySegments steps={welcome.steps} active={step.sourceTaskId} signedIn={signedIn} onChoose={choose} />
          <div className="story-top"><button type="button" onClick={onBack}>← {welcome.campaign.name}</button><span>{String(index + 1).padStart(2, "0")} / {String(welcome.steps.length).padStart(2, "0")}</span></div>
        </div>
        <div className="story-ask">
          <p className="story-state">{storyState(step, signedIn)}</p>
          <h1>{step.description}</h1>
          {signedIn && step.state === "done" ? <div className="story-result" role="status"><strong>Accepted · {step.points} points</strong><p>This favour is complete. Your campaign record keeps the result.</p>{done < welcome.steps.length && <button type="button" onClick={() => choose(welcome.steps.find((s) => s.state === "todo")?.sourceTaskId ?? welcome.steps[(index + 1) % welcome.steps.length].sourceTaskId)}>Choose your next favour ↗</button>}</div>
            : <button type="button" className="story-action" onClick={() => { choose(step.sourceTaskId); onStart(step); }} disabled={busyId === step.sourceTaskId}>{busyId === step.sourceTaskId ? "Opening…" : !signedIn ? `${step.points} points · sign in to start ↗` : step.state === "todo" ? `${step.points} points · do this favour ↗` : step.state === "sent" && !hasSavedStoryProof(step) ? "Continue this favour ↗" : "Open saved proof ↗"}</button>}
          {signedIn && step.state === "sent" && hasSavedStoryProof(step) && <p className="story-result-note">Your proof is saved, but checking was unavailable. No points were added. Open it to try again.</p>}
          {signedIn && step.state === "in_review" && <p className="story-result-note">Three qualified reviewers look at your proof; two must accept. No points yet. You may send new proof.</p>}
          {signedIn && step.state === "todo" && step.reviewNote && <div className="story-result-note"><p>Your last proof was not accepted. No points were added. You can try again.</p>{step.reviewNote.reasons.map((reason, i) => <p key={i}>&ldquo;{reason}&rdquo;</p>)}</div>}
          {error && <p role="alert" className="story-error">{error}</p>}
          <p className="story-photo-note">Campaign illustration, not submitted proof.</p>
        </div>
      </div>
    </section>
    <div className="stories-content">
      <div className="story-browse-nav"><button type="button" disabled={index === 0} onClick={() => choose(welcome.steps[index - 1].sourceTaskId)}>← Previous</button><span>{done} accepted · {welcome.steps.length - done} to go</span><button type="button" disabled={index === welcome.steps.length - 1} onClick={() => choose(welcome.steps[index + 1].sourceTaskId)}>Next →</button></div>
      {waiting > 0 && <p className="stories-muted">{waiting} awaiting a result. Waiting is not acceptance.</p>}
      <section aria-label="Other favours"><h2>Next in this campaign</h2><div className="story-tiles">{welcome.steps.filter((s) => s.sourceTaskId !== step.sourceTaskId).map((s) => {
        const item = storyArt(s.description); const n = welcome.steps.indexOf(s) + 1;
        return <button key={s.sourceTaskId} type="button" onClick={() => choose(s.sourceTaskId)} aria-label={`Open favour ${n}: ${item.title}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}<img src={item.image} alt="" /><span><strong>{String(n).padStart(2,"0")} · {item.title}</strong><small>{s.points} points · {storyState(s,signedIn)}</small></span></button>;
      })}</div></section>
      <details className="story-help"><summary>How proof, points and progress work</summary><p>Do the favour yourself. Send your own photo or note and consent before sending. An accepted result adds the stated points and remains on your campaign record. If checking is unavailable, no points change. You can return and try again.</p><p>Points only. No USDC is paid by this campaign. Runs until {new Date(welcome.campaign.endsAt).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}.</p></details>
      <p className="stories-muted">These are the original Welcome favours, first posted on 5 Jul 2026. The texts are unchanged. Photos illustrate the prompts; they are not submissions.</p>
      <button type="button" className="story-secondary" onClick={onDiscover}>Discover more favours ↗</button>
    </div>
  </div>;
}
