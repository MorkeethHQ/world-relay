"use client";

import type { HunterProfile } from "@/lib/hunter-profile";
import styles from "./HunterCard.module.css";

// THE TOP OF THE PROFILE (Oscar, 8 Oct 2026: "more Hunter and feedbacker, how many
// projects, how many reviews"). One line says what this person does on FAVOUR,
// then three counts from hunter-profile.ts, then the last products they reviewed.
//
// No level and no badge: FAVOUR has no rule for one yet. Points stay amber. A
// GitHub name shows only when the caller says it is verified; a typed name
// proves nothing, so it is never shown as a link to a person.
//
// Not used by any screen yet. `/look` shows it in development only.

function Count({ n, label }: { n: number; label: string }) {
  return (
    <div className="min-w-0 flex-1">
      <span className="block text-[28px] font-extrabold leading-none tabular-nums text-gray-900">{n}</span>
      <span className="mt-1 block text-xs text-gray-400">{label}</span>
    </div>
  );
}

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
    <section className="rounded-2xl border border-gray-200 bg-white p-4" aria-label="Your work on FAVOUR">
      <h2 className={`${styles.name} truncate text-gray-900`}>{name}</h2>
      <p className="mt-0.5 text-sm text-gray-600">
        {nothing
          ? "No review yet. Pick a product and say what you think."
          : `Reviewed ${profile.products} ${profile.products === 1 ? "product" : "products"}${profile.launched ? `, launched ${profile.launched}` : ""}.`}
      </p>

      <div className="mt-4 flex gap-3">
        <Count n={profile.products} label={profile.products === 1 ? "product reviewed" : "products reviewed"} />
        <Count n={profile.reviews} label={profile.reviews === 1 ? "review accepted" : "reviews accepted"} />
        <Count n={profile.launched} label={profile.launched === 1 ? "product launched" : "products launched"} />
      </div>

      <p className="text-xs text-gray-400 tabular-nums" style={{ marginTop: 16 }}>
        <span className="font-semibold text-amber-600">{profile.points} pts</span>
        {profile.favours > 0 && ` · ${profile.favours} other ${profile.favours === 1 ? "favour" : "favours"} done`}
        {github?.verified && ` · GitHub ${github.name}`}
      </p>

      {profile.latest.length > 0 && (
        <ul className="mt-3 border-t border-gray-200 pt-3 text-sm text-gray-900">
          {profile.latest.map((l) => (
            <li key={l.label + l.at} className="flex justify-between gap-3 py-1">
              <span className="truncate">{l.label}</span>
              <time dateTime={l.at} className="shrink-0 text-xs text-gray-400">{new Date(l.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
