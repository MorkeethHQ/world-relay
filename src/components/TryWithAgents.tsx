"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TopBar } from "@worldcoin/mini-apps-ui-kit-react";
import { CONDITIONS, DEBATE, DEFAULT_TASK, FIXED_LINE, FORECAST, STANDIN_LINE, STEPS, TRACKS, UNTESTED_IDEA, finished, standinOutcome, type Condition, type Outcome, type Version } from "@/lib/sim-standin";
import talk from "./Talk.module.css";
import styles from "./TryWithAgents.module.css";

// TRY IT WITH AGENTS, /p/<id>/try. A LOCAL PREVIEW behind a flag (Oscar, 10 Oct
// 2026: "maybe try Favour app or something usable", "if we keep it fun micro
// animations, debating multi model"). DESIGN-SYSTEM.md, "Try it with agents".
//
// ONE SCREEN since 11 Oct 2026 (Oscar, 00:37: "still TOO many clicks, not
// intuitive at all, weird way for users to input hypothesis and bets"). The
// link, one change, one bet (up, same or down), Run, the tracks, and the result
// against the bet. Three taps from the project page: the entry button, the bet,
// Run. The traces and the debate sit under the result, one more tap, for a
// person who wants the evidence.
//
// NOTHING HERE RAN. Every trace, stop and claim comes from lib/sim-standin.ts,
// written by hand, and the screen prints STANDIN_LINE. This screen calls no
// model, opens no link, reads no route but the project's name, writes nothing,
// and touches no reward, wallet or post. The bet is no money and no points, and
// it stays on this screen. A real trial replaces the stand-in file; this screen
// must never print a stand-in without the line.

const VERSION: Record<Version, string> = { base: "Today's version", candidate: "With the change" };
const BET: { id: Outcome; label: string }[] = [{ id: "up", label: "More finish" }, { id: "none", label: "Same" }, { id: "down", label: "Fewer finish" }];
const WORD: Record<Outcome, string> = { up: "more", none: "the same number", down: "fewer" };
const TICK_MS = 550;
const nameOf = (id: Condition["id"]) => CONDITIONS.find((c) => c.id === id)!.name;

function Back({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="tertiary" size="icon" className="min-h-[44px]" onClick={onBack} aria-label="Back">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
    </Button>
  );
}

/** The steps one stand-in track took, and where it stopped. */
function Trace({ condition, version }: { condition: Condition["id"]; version: Version }) {
  const track = TRACKS[version].find((t) => t.condition === condition)!;
  const upTo = track.stopAt ?? STEPS.length;
  return (
    <div className={styles.trace} aria-label={`${nameOf(condition)} trace, ${VERSION[version]}`}>
      <p className={styles.eyebrow}>{nameOf(condition)} · {VERSION[version]} · stand-in trace</p>
      <ol className={styles.steps}>
        {STEPS.slice(0, upTo).map((s) => {
          const stop = track.stopAt === s.n;
          return (
            <li key={s.n} className={stop ? styles.stepStop : undefined}>
              <b>{s.n}. {s.action}</b>
              <span>{stop ? track.why : s.response}</span>
            </li>
          );
        })}
      </ol>
      <p className={styles.note}>Checker result: none. No checker ran in this preview.</p>
    </div>
  );
}

export function TryWithAgents({ id }: { id: string }) {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const runSide = useRef<HTMLElement | null>(null);
  const [bet, setBet] = useState<Outcome | null>(null);
  // How many steps the tracks have reached. 0 is before Run; STEPS.length is the end.
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState<{ version: Version; condition: Condition["id"] } | null>(null);
  const [more, setMore] = useState(false);
  const [cited, setCited] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const result = useRef<HTMLDivElement | null>(null);

  // The project's own name and link, for the heading and the first field. A failed read leaves both empty.
  useEffect(() => {
    let live = true;
    fetch(`/api/project/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const p = d?.project;
        if (!live || !p) return;
        const n = p.kind === "favour" ? p.product?.name : p.name;
        const u = p.kind === "favour" ? p.product?.productUrl : p.url;
        if (typeof n === "string") setName(n);
        if (typeof u === "string") setUrl(u);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [id]);

  const stopClock = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const still = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const done = at >= STEPS.length;
  const running = at > 0 && !done;

  // The result is under the tracks. On a phone it is below the fold, so the screen brings it into view.
  useEffect(() => {
    if (done) result.current?.scrollIntoView?.({ behavior: still() ? "auto" : "smooth", block: "nearest" });
  }, [done]);

  const run = () => {
    if (!bet) return;
    stopClock();
    setOpen(null);
    // With reduced motion the tracks are drawn at their end and nothing moves.
    if (still()) { setAt(STEPS.length); return; }
    // On a phone the tracks are under the bet, so the screen brings them into view before they move.
    runSide.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    let n = 1;
    setAt(n);
    timer.current = setInterval(() => {
      n = Math.min(n + 1, STEPS.length);
      setAt(n);
      if (n >= STEPS.length) stopClock();
    }, TICK_MS);
  };
  const again = () => { stopClock(); setAt(0); setOpen(null); setMore(false); setCited(null); };
  const leave = () => { stopClock(); router.push(`/p/${encodeURIComponent(id)}`); };

  const out = standinOutcome();
  const now = STEPS[Math.max(0, Math.min(at, STEPS.length) - 1)];

  return (
    <div className={`${talk.screen} ${styles.screen}`} aria-label="Try it with agents">
      <TopBar startAdornment={<Back onBack={leave} />} title="Try it with agents" />
      <div className={styles.body}>
        <p className={styles.standin} role="note">{STANDIN_LINE}</p>

        <div className={styles.cols}>
          <section aria-label="Your bet" className={styles.ask}>
            <h1 className={styles.heading}>{name ? `Will a change help ${name}?` : "Will a change help?"}</h1>
            <p className={styles.line}>Three agents try one task on today&apos;s version and with one change. You bet first.</p>
            <div className={styles.rows} aria-label="The example">
              <div className={styles.row}><span><small>Project link</small><b>{url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "No link in this preview"}</b></span><em>Example</em></div>
              <div className={styles.row}><span><small>The one change</small><b>{FORECAST.edit}</b></span><em>Example</em></div>
            </div>
            <p className={styles.label} id="try-bet">Your bet: with the change, how many of the three finish?</p>
            <div className={styles.seg} role="radiogroup" aria-labelledby="try-bet">
              {BET.map((b) => (
                <button key={b.id} type="button" role="radio" className="min-h-[44px]" aria-checked={bet === b.id} disabled={at > 0} onClick={() => setBet(b.id)}>{b.label}</button>
              ))}
            </div>
            <p className={styles.note} role="note">No money and no points. {FIXED_LINE}</p>
            <div className={styles.acts}>
              {at === 0 && <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" disabled={!bet} onClick={run}>{bet ? "Run the stand-in" : "Pick a bet to run"}</Button>}
              {done && <Button variant="tertiary" size="lg" fullWidth className="min-h-[44px]" onClick={again}>Bet again</Button>}
            </div>
          </section>

          <section aria-label="The run" className={styles.runSide} ref={runSide}>
            <p className={styles.task}><small>The task</small>{DEFAULT_TASK}</p>
            {(["base", "candidate"] as const).map((v) => (
              <div key={v} className={styles.group} aria-label={VERSION[v]}>
                <p className={styles.groupHead}><b>{VERSION[v]}</b><small>{v === "candidate" ? "The picture step can be skipped" : "The post flow as it is"} · stand-in</small></p>
                <div className={styles.tracks}>
                  {TRACKS[v].map((t) => {
                    const reach = Math.min(at, t.stopAt ?? STEPS.length);
                    const stopped = t.stopAt !== null && at >= t.stopAt;
                    const state = at === 0 ? "Ready" : stopped ? `Stopped at step ${t.stopAt}` : reach >= STEPS.length ? "Finished" : `Step ${reach}`;
                    const isOpen = open?.version === v && open.condition === t.condition;
                    return (
                      <button key={t.condition} type="button" className={`min-h-[44px] ${styles.track} ${isOpen ? styles.trackOpen : ""}`} disabled={at === 0} onClick={() => setOpen(isOpen ? null : { version: v, condition: t.condition })} aria-expanded={isOpen} aria-label={`${nameOf(t.condition)}, ${VERSION[v]}: ${state}. Open the trace`}>
                        <span className={styles.trackHead}><b>{nameOf(t.condition)}</b><small className={stopped ? styles.red : undefined}>{stopped ? `Stop at ${t.stopAt}` : state}</small></span>
                        <span className={styles.cells} aria-hidden="true">
                          {STEPS.map((s) => (
                            <i key={s.n} className={`${s.n <= reach ? styles.cellOn : ""} ${stopped && s.n === t.stopAt ? styles.cellStop : ""}`}>{stopped && s.n === t.stopAt ? "×" : s.n}</i>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {open?.version === v && at > 0 && <Trace condition={open.condition} version={v} />}
              </div>
            ))}
            {/* The step the tracks are on and the page's answer, both from STEPS. The key remounts the line, so it eases in. */}
            <p className={styles.now} aria-live="off">
              <span key={at}>{at === 0 ? "Not started. Pick a bet, then run." : done ? "The stand-in is at its end. Tap a track to read its trace." : (<><b>Step {now.n}: {now.action}</b>{now.response}</>)}</span>
            </p>

            {done && bet && (
              <div className={styles.result} role="status" ref={result}>
                <p className={styles.eyebrow}>Result against your bet · stand-in</p>
                <p className={styles.verdict}>You bet {WORD[bet]}. The stand-in shows {WORD[out]}.</p>
                <p className={styles.match}><i>{bet === out ? "Your bet matches" : "Your bet does not match"}</i></p>
                <dl className={styles.kv}>
                  <div><dt>{VERSION.base}</dt><dd>{finished("base")} of {TRACKS.base.length} finished</dd></div>
                  <div><dt>{VERSION.candidate}</dt><dd>{finished("candidate")} of {TRACKS.candidate.length} finished</dd></div>
                  <div><dt>Evidence</dt><dd>Written by hand. One run each. Too few to rank.</dd></div>
                  <div><dt>Held-out run</dt><dd>Not run</dd></div>
                </dl>
                <p className={styles.note}>No model trial has run in this preview. A match here says nothing about the change or about your judgement.</p>
                <div className={styles.acts}>
                  <Button variant="secondary" size="lg" fullWidth className="min-h-[44px]" onClick={() => setMore(!more)} aria-expanded={more}>{more ? "Hide what the agents said" : "See what the agents said"}</Button>
                  <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" onClick={leave}>Back to {name ?? "the project"}</Button>
                </div>
              </div>
            )}
          </section>
        </div>

        {done && more && (
          <section aria-label="What the agents said">
            <p className={styles.line}>Each condition points to a trace, questions another reading, and gives one change. They do not agree, and nothing is added up.</p>
            <div className={styles.grid}>
              {DEBATE.map((c, i) => (
                <article key={c.condition} className={styles.card} aria-label={`${nameOf(c.condition)} says`}>
                  <p className={styles.cardName}>{nameOf(c.condition)} <small>stand-in</small></p>
                  <p className={styles.says}>{c.says}</p>
                  {c.trace ? (
                    <button type="button" className={`min-h-[44px] ${styles.cite}`} onClick={() => setCited(cited === i ? null : i)} aria-expanded={cited === i}>
                      Trace: {nameOf(c.trace.condition)}, step {c.trace.step} <i aria-hidden="true">›</i>
                    </button>
                  ) : (
                    <p className={styles.hypothesis}>Hypothesis. No trace supports this claim.</p>
                  )}
                  {cited === i && c.trace && <Trace condition={c.trace.condition} version="base" />}
                  <p className={styles.cardLine}><b>To {nameOf(c.challenges)}:</b> {c.challenge}</p>
                  <p className={styles.cardLine}><b>One change:</b> {c.change}</p>
                </article>
              ))}
            </div>
            <div className={styles.rows}>
              <div className={styles.row}><span><b>A second idea, not tested</b><small>{UNTESTED_IDEA} It is in no run here.</small></span><em>Untested</em></div>
            </div>
          </section>
        )}
        {running && <p className={styles.srOnly} role="status">Running the stand-in</p>}
      </div>
    </div>
  );
}
