"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TopBar } from "@worldcoin/mini-apps-ui-kit-react";
import { CANDIDATE_LINE, CONDITIONS, DEBATE, DEFAULT_TASK, FORECAST, STANDIN_LINE, STEPS, TRACKS, failedSteps, finished, firstStop, type Condition, type Version } from "@/lib/sim-standin";
import { Field } from "./Kit";
import talk from "./Talk.module.css";
import styles from "./TryWithAgents.module.css";

// TRY IT WITH AGENTS, /p/<id>/try. A LOCAL PREVIEW behind a flag (Oscar, 10 Oct
// 2026: "maybe try Favour app or something usable", "if we keep it fun micro
// animations, debating multi model"). DESIGN-SYSTEM.md, "Try it with agents".
//
// Five steps on one route: bring the thing, choose the panel, watch them try,
// hear the debate, choose a test. Back on step 1 returns to the project page.
//
// NOTHING HERE RAN. Every trace, stop, claim and forecast comes from
// lib/sim-standin.ts, written by hand, and every step prints STANDIN_LINE. This
// screen calls no model, opens no link, reads no route but the project's name,
// writes nothing, and touches no reward, wallet or post. A real trial replaces
// the stand-in file; this screen must never print a stand-in without the line.

const TITLES = ["Bring the thing", "Choose the panel", "Watch them try", "Hear the debate", "Choose a test"] as const;
const VERSION: Record<Version, string> = { base: "Today's version", candidate: "Candidate" };
const WORD = { up: "Up", down: "Down", none: "None" } as const;
const TICK_MS = 650;
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
  const [step, setStep] = useState(0);
  const [name, setName] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [candidate, setCandidate] = useState("");
  const [task, setTask] = useState(DEFAULT_TASK);
  const [version, setVersion] = useState<Version>("base");
  // Step 3: how many steps the tracks have reached, and the pause at the first stop.
  const [at, setAt] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<Condition["id"] | null>(null);
  const [cited, setCited] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

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
        if (typeof u === "string") setUrl((v) => v || u);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [id]);

  const stop = firstStop(version);
  const stopClock = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setRunning(false); };
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const run = (from: number) => {
    stopClock();
    setPaused(false);
    // With reduced motion the tracks are drawn at their end, with the first stop named, and nothing moves.
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setAt(STEPS.length);
      return;
    }
    let n = from;
    setAt(n);
    setRunning(true);
    timer.current = setInterval(() => {
      n = Math.min(n + 1, STEPS.length);
      setAt(n);
      if (stop && n === stop.stopAt && from < n) { stopClock(); setPaused(true); setOpen(stop.condition); }
      else if (n >= STEPS.length) stopClock();
    }, TICK_MS);
  };
  const reset = (v: Version) => { stopClock(); setVersion(v); setAt(0); setPaused(false); setOpen(null); };

  const back = () => { stopClock(); if (step === 0) router.push(`/p/${encodeURIComponent(id)}`); else setStep(step - 1); };
  const next = () => { stopClock(); setStep(Math.min(step + 1, TITLES.length - 1)); };
  const done = at >= STEPS.length;

  return (
    <div className={`${talk.screen} ${styles.screen}`} aria-label="Try it with agents">
      <TopBar startAdornment={<Back onBack={back} />} title="Try it with agents" />
      <div className={styles.body}>
        <p className={styles.standin} role="note">{STANDIN_LINE}</p>
        <ol className={styles.rail} aria-label="Steps">
          {TITLES.map((t, i) => (
            <li key={t} aria-current={i === step ? "step" : undefined} className={i < step ? styles.railDone : undefined}>
              <button type="button" className={`min-h-[44px] ${styles.railBtn}`} onClick={() => { stopClock(); setStep(i); }} aria-label={`Step ${i + 1}: ${t}`}>
                <i>{i + 1}</i><span>{t}</span>
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section aria-label={TITLES[0]}>
            <h1 className={styles.heading}>{TITLES[0]}</h1>
            <p className={styles.line}>{name ? `${name}: give` : "Give"} the link, one task, and the change you think of.</p>
            <div className={styles.fields}>
              <Field id="try-url" label="Today's version, a live link" type="url" inputMode="url" value={url} onChange={setUrl} placeholder="https://" maxLength={300} />
              <Field id="try-candidate" label="Candidate, a preview link" type="url" inputMode="url" value={candidate} onChange={setCandidate} placeholder="https://" maxLength={300} />
              <Field id="try-task" label="One task" value={task} onChange={setTask} maxLength={140} />
            </div>
            <div className={styles.card}>
              <p className={styles.eyebrow}>What can be reached</p>
              <p className={styles.cardLine}>This preview opens no link. A real trial reads both links first and lists the pages and fields it can reach.</p>
              <p className={styles.cardLine}>You name the task. No task and no checker is made from a link alone.</p>
            </div>
          </section>
        )}

        {step === 1 && (
          <section aria-label={TITLES[1]}>
            <h1 className={styles.heading}>{TITLES[1]}</h1>
            <p className={styles.line}>Three agent conditions try the same task. Every setting is shown and frozen before a run.</p>
            <div className={styles.grid}>
              {CONDITIONS.map((c) => (
                <div key={c.id} className={styles.card} aria-label={c.name}>
                  <p className={styles.cardName}>{c.name} <small>stand-in</small></p>
                  <dl className={styles.kv}>
                    <div><dt>Model</dt><dd>{c.model}</dd></div>
                    <div><dt>Tools</dt><dd>{c.tools}</dd></div>
                    <div><dt>Task</dt><dd>{task || "No task named"}</dd></div>
                    <div><dt>Controller</dt><dd>{c.controller}</dd></div>
                    <div><dt>Cost cap</dt><dd>{c.cap}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
            <div className={styles.rows}>
              <div className={styles.row}><span><b>Saved panel</b><small>None yet. A saved panel shows its last check date and its blind spots.</small></span><em>None</em></div>
              <div className={styles.row}><span><b>New persona</b><small>A persona you write is not checked against people.</small></span><em>Uncalibrated</em></div>
              <div className={styles.row}><span><b>Human customers</b><small>A separate arm. It needs people who agreed to be observed.</small></span><em>Not available</em></div>
            </div>
          </section>
        )}

        {step === 2 && (
          <section aria-label={TITLES[2]}>
            <h1 className={styles.heading}>{TITLES[2]}</h1>
            <p className={styles.line}>{task || "No task named"}</p>
            <div className={styles.seg} role="tablist" aria-label="Version">
              {(["base", "candidate"] as const).map((v) => (
                <button key={v} type="button" role="tab" className="min-h-[44px]" aria-selected={version === v} onClick={() => reset(v)}>{VERSION[v]}</button>
              ))}
            </div>
            {version === "candidate" && <p className={styles.note}>{CANDIDATE_LINE} A stand-in change.</p>}

            <div className={styles.tracks}>
              {TRACKS[version].map((t) => {
                const reach = Math.min(at, t.stopAt ?? STEPS.length);
                const stopped = t.stopAt !== null && at >= t.stopAt;
                const state = at === 0 ? "Ready" : stopped ? `Stopped at step ${t.stopAt}` : reach >= STEPS.length ? "Finished" : `Step ${reach}`;
                return (
                  <button key={t.condition} type="button" className={`min-h-[72px] ${styles.track} ${open === t.condition ? styles.trackOpen : ""}`} onClick={() => setOpen(open === t.condition ? null : t.condition)} aria-expanded={open === t.condition} aria-label={`${nameOf(t.condition)}: ${state}. Open the trace`}>
                    <span className={styles.trackHead}><b>{nameOf(t.condition)}</b><small>{state}</small></span>
                    <span className={styles.cells} aria-hidden="true">
                      {STEPS.map((s) => (
                        <i key={s.n} className={`${s.n <= reach ? styles.cellOn : ""} ${stopped && s.n === t.stopAt ? styles.cellStop : ""}`}>{stopped && s.n === t.stopAt ? "×" : s.n}</i>
                      ))}
                    </span>
                    <span className={styles.now}>{at === 0 ? "Not started" : stopped ? t.why : STEPS[Math.max(0, reach - 1)].action}</span>
                  </button>
                );
              })}
            </div>

            {paused && stop && (
              <div className={styles.stopCard} role="status">
                <p className={styles.cardName}>First stop: {nameOf(stop.condition)}, step {stop.stopAt}</p>
                <p className={styles.cardLine}>{STEPS[(stop.stopAt as number) - 1].action}. {stop.why}</p>
              </div>
            )}
            {done && !stop && <p className={styles.note}>No track stopped on this version.</p>}
            {open && at > 0 && <Trace condition={open} version={version} />}

            <div className={styles.acts}>
              {at === 0 && <Button variant="secondary" size="lg" fullWidth className="min-h-[44px]" onClick={() => run(0)}>Play the stand-in</Button>}
              {paused && <Button variant="secondary" size="lg" fullWidth className="min-h-[44px]" onClick={() => run(at)}>Continue</Button>}
              {at > 0 && !running && !paused && <Button variant="tertiary" size="lg" fullWidth className="min-h-[44px]" onClick={() => reset(version)}>Play again</Button>}
            </div>
          </section>
        )}

        {step === 3 && (
          <section aria-label={TITLES[3]}>
            <h1 className={styles.heading}>{TITLES[3]}</h1>
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
          </section>
        )}

        {step === 4 && (
          <section aria-label={TITLES[4]}>
            <h1 className={styles.heading}>{TITLES[4]}</h1>
            <p className={styles.line}>Today&apos;s version and the candidate, side by side. Choose what to test with real people.</p>
            <div className={styles.compare}>
              {(["base", "candidate"] as const).map((v) => (
                <div key={v} className={styles.card} aria-label={VERSION[v]}>
                  <p className={styles.cardName}>{VERSION[v]} <small>stand-in</small></p>
                  <dl className={styles.kv}>
                    <div><dt>Finished the task</dt><dd>{finished(v)} of {TRACKS[v].length}</dd></div>
                    <div><dt>Steps with a stop</dt><dd>{failedSteps(v).length ? failedSteps(v).join(", ") : "None"}</dd></div>
                    <div><dt>Uncertainty</dt><dd>One run each. Too few to rank.</dd></div>
                  </dl>
                </div>
              ))}
            </div>
            <div className={styles.rows}>
              <div className={styles.row}><span><b>Suggested edit</b><small>{FORECAST.edit}</small></span></div>
              <div className={styles.row}><span><b>Panel forecast for a held-out agent</b><small>Up, down or none. Not sealed: nothing ran.</small></span><em>{WORD[FORECAST.panel]} · stand-in</em></div>
              <div className={styles.row}><span><b>Diff reader&apos;s guess</b><small>A guess from the change alone, with no trial.</small></span><em>{WORD[FORECAST.diffReader]} · stand-in</em></div>
              <div className={styles.row}><span><b>Held-out run</b><small>The forecast is compared with this run, a tie or a failure included.</small></span><em>Not run</em></div>
            </div>
            <p className={styles.note}>No model trial has run in this preview. This screen makes no claim that a forecast is right.</p>
          </section>
        )}

        <div className={styles.foot}>
          {step < TITLES.length - 1 ? (
            <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" onClick={next}>Next: {TITLES[step + 1]}</Button>
          ) : (
            <Button variant="primary" size="lg" fullWidth className="min-h-[44px]" onClick={() => router.push(`/p/${encodeURIComponent(id)}`)}>Back to {name ?? "the project"}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
