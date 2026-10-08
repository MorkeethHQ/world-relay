"use client";

import type { HunterProfile } from "@/lib/hunter-profile";
import { Card, Counts } from "./Kit";
import styles from "./HunterCard.module.css";

// THE TOP OF THE PROFILE (Oscar, 8 Oct 2026: "more Hunter and feedbacker, how many
// projects, how many reviews"). One line says what this person does on FAVOUR,
// then three counts from hunter-profile.ts, then the last products they reviewed.
// Drawn with the one kit.
//
// No level and no badge: FAVOUR has no rule for one yet. Points stay amber. A
// GitHub name shows only when the caller says it is verified; a typed name
// proves nothing, so it is never shown as a link to a person.

export function HunterCard({
  name,
  profile,
  github,
}: {
  name: string;
  profile: HunterProfile;
  github?: { name: string; verified: boolean } | null;
}) {
  const nothing = profile.reviews === 0 && profile.launched === 0;
  return (
    <Card label="Your work on FAVOUR">
      <h2 className={styles.name}>{name}</h2>
      <p className={styles.line}>
        {nothing
          ? "No review yet. Pick a product and say what you think."
          : `Reviewed ${profile.products} ${profile.products === 1 ? "product" : "products"}${profile.launched ? `, launched ${profile.launched}` : ""}.`}
      </p>

      <Counts items={[
        { n: profile.products, label: profile.products === 1 ? "product reviewed" : "products reviewed" },
        { n: profile.reviews, label: profile.reviews === 1 ? "review accepted" : "reviews accepted" },
        { n: profile.launched, label: profile.launched === 1 ? "product launched" : "products launched" },
      ]} />

      <p className={styles.points}>
        <span className="font-semibold text-amber-600">{profile.points} pts</span>
        {profile.favours > 0 && ` · ${profile.favours} other ${profile.favours === 1 ? "favour" : "favours"} done`}
        {github?.verified && ` · GitHub ${github.name}`}
      </p>

      {profile.latest.length > 0 && (
        <ul className={styles.latest}>
          {profile.latest.map((l) => (
            <li key={l.label + l.at} className={styles.latestRow}>
              <span className={styles.latestLabel}>{l.label}</span>
              <time dateTime={l.at} className={styles.latestAt}>{new Date(l.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
