/**
 * Kill-number readout for the daily loop.
 *
 *   npx tsx scripts/daily-survival.ts [weeksBack]
 *
 * Prints, per ISO week: actives, MEDIAN active-user days/week (the kill
 * number), mean, the 1..7 days histogram, and week-over-week retention.
 * Data source: daily:hist:* sets written at submit time (src/lib/daily.ts).
 * Read-only — this script never writes to Redis.
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Works under both runners: `npx tsx` (CJS, __dirname) and plain node ESM.
const scriptDir =
  typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
config({ path: resolve(scriptDir, "..", ".env.local") });

async function main() {
  const { readSurvival } = await import("../src/lib/daily-survival");
  const weeksBack = Number(process.argv[2]) || 6;
  const weeks = await readSurvival(Date.now(), weeksBack);

  console.log(`\nDAILY LOOP SURVIVAL — kill number = median active-user days/week\n`);
  console.log(
    "week        actives  median  mean   retained  histogram (days:users)",
  );
  for (const w of weeks) {
    const hist = Object.entries(w.daysDistribution)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([d, c]) => `${d}:${c}`)
      .join(" ");
    const retained = w.retainedFromPrev === null ? "   —" : `${Math.round(w.retainedFromPrev * 100)}%`.padStart(4);
    console.log(
      `${w.week}    ${String(w.actives).padStart(5)}   ${String(w.medianDaysPerWeek).padStart(5)}  ${w.meanDaysPerWeek.toFixed(2).padStart(5)}  ${retained}     ${hist || "—"}`,
    );
  }

  const last = weeks[weeks.length - 1];
  if (last && last.actives === 0) {
    console.log("\nNo history yet this week — the sets fill from the first submit after this ships.");
  }
  console.log(
    "\nRead: median 1 = one-shot curiosity (kill). median 3+ = ritual forming (keep).\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
