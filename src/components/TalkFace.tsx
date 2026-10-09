"use client";

import { Marble } from "@worldcoin/mini-apps-ui-kit-react";
import { initialOf } from "@/lib/content-rules";
import styles from "./Talk.module.css";

// WHO WROTE. A person is a round face: the kit's Marble when World gave a
// picture, else the first letter of the username in a round. An agent is an
// outlined square mark (5B), never a Marble, so it never reads as a person.

export type FaceOf = { kind: "person" | "agent"; name: string; picture: string | null };

export function TalkFace({ who, large = false }: { who: FaceOf; large?: boolean }) {
  if (who.kind === "agent") return <span className={styles.agentMark} aria-hidden="true">A</span>;
  if (who.picture) return <Marble src={who.picture} alt="" className={large ? styles.marbleLarge : styles.marble} />;
  return <span className={`${styles.face} ${large ? styles.faceLarge : ""}`} aria-hidden="true">{initialOf(who.name.replace(/^@/, ""))}</span>;
}
