"use client";

import { useState } from "react";
import { inkOn, pictureSteps } from "@/lib/content-rules";
import styles from "./Talk.module.css";

// THE SMALL PICTURE OF AN APP, one frame for every room (Oscar, 9 Oct 2026:
// "we should have a small project image for it so it looks more fun"). Three
// shapes, all the same frame: square (1A: 48, smaller in a room's top bar),
// wide (1C: 84 by 56, a square again under 360 px) and cover (the lead card).
// The chain is content-rules.ts: the share picture, then the icon on the app's
// own colour, then the first letter. The colour sits inside this frame only,
// and only when productColour() allows it (groundOf), so it is never the amber
// of points or the green of money. A real picture gets no colour behind it.

// "tile" (9 Oct 2026, the Hall): a square that fills its column, for a podium.
export type PictureShape = "square" | "squareSmall" | "wide" | "cover" | "tile";

export function TalkPicture({ name, url, icon, colour, shape = "square" }: {
  name: string;
  url: string | null;
  icon: string | null;
  colour: string | null;
  shape?: PictureShape;
}) {
  const chain = pictureSteps({ url, icon, colour, name });
  // A share picture is wide. In a square it is cut to a strip of letters, so a
  // square frame takes the icon first when the app has one.
  const square = shape === "square" || shape === "squareSmall" || shape === "tile";
  const steps = square ? [...chain.filter((s) => s.kind === "icon"), ...chain.filter((s) => s.kind !== "icon")] : chain;
  // A link that failed to load is remembered by its address, so a new picture starts the chain again.
  const [failed, setFailed] = useState<string[]>([]);
  const step = steps.find((s) => s.kind === "initial" || !failed.includes(s.url)) ?? steps[steps.length - 1];
  const next = () => { if (step.kind !== "initial") setFailed((f) => [...f, step.url]); };
  const cls = `${styles.frame} ${styles[shape]}`;

  if (step.kind === "picture") {
    return (
      <span className={cls} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={step.url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={next} />
      </span>
    );
  }
  if (step.kind === "icon") {
    return (
      <span className={cls} style={{ background: step.ground }} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={step.url} alt="" loading="lazy" referrerPolicy="no-referrer" className={styles.iconStep} onError={next} />
      </span>
    );
  }
  return <span className={cls} style={{ background: step.ground, color: inkOn(colour) === "white" ? "#fff" : undefined }} aria-hidden="true">{step.letter}</span>;
}
