import { FavourArt, artFor } from "./FavourArt";
import styles from "./FavourStamp.module.css";

// THE FAVOUR'S PICTURE IN THE PROOF STEP, and the reward stamp (Oscar, 11 Oct
// 2026, 01:23: "1 yes, elegant stamp not the slop designed one though").
// DESIGN-SYSTEM.md, "Favour art".
//
// The picture a favour has on the board stays with it while the person answers,
// while the answer is checked, and on the result. The stamp is one mark with one
// motion: an ink ring with the points the SERVER wrote, pressed once. It is
// drawn only for an accepted proof with a points number from the server. It is
// never drawn for a proof that waits for a review, for a fallback number, or
// for USDC. It changes no reward: it shows the number the result already shows.

/** True only when the server accepted the proof and wrote a points number above zero. */
export function stampPoints(result: { verdict: string; pointsAwarded?: number | null } | null, rewardType: string | undefined): number | null {
  if (!result || result.verdict !== "pass" || rewardType !== "points") return null;
  const n = result.pointsAwarded;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function ProofPicture({ task, points }: { task: { id: string; description?: string | null; category?: string | null }; points: number | null }) {
  return (
    <div className={styles.picture} data-proof-picture>
      <FavourArt kind={artFor(task)} seed={task.id} className={styles.art} />
      {points !== null && (
        <span className={styles.stamp} aria-hidden="true" data-stamp={points}>
          <b>+{points}</b>
          <small>pts</small>
        </span>
      )}
    </div>
  );
}
