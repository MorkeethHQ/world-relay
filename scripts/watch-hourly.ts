/**
 * Hourly prod watcher (launchd com.favour.watch) — catches moments the daily
 * pulse would miss by up to 24h: the FIRST unlock payout, site down, activity
 * bursts. Writes a live ticker to the Obsidian dashboard and fires a macOS
 * notification only for events worth interrupting for. Read-only.
 */
import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import * as os from "os";

config({ path: resolve(__dirname, "../.env.local") });

const APP = "https://world-relay.vercel.app";
const STATE = resolve(__dirname, ".watch-state.json");
const TICKER = resolve(
  os.homedir(),
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian LIFE/00 Dashboard/favour-live.md"
);

type State = { unlock_paid: number; jury_verdict: number; sign_in: number; poll_vote: number; prediction_stake: number; completedCount: number };

function notify(title: string, body: string) {
  try { execSync(`osascript -e 'display notification "${body.replace(/"/g, "")}" with title "${title.replace(/"/g, "")}" sound name "Glass"'`); } catch {}
}

async function main() {
  const ts = new Date().toISOString();
  const prev: State | null = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null;

  // Health first: if the board is down, that's the only thing that matters.
  let boardOk = false;
  let openCount = 0;
  let completedCount = 0;
  try {
    const res = await fetch(`${APP}/api/tasks`, { signal: AbortSignal.timeout(15000) });
    boardOk = res.ok;
    if (res.ok) {
      const d = await res.json();
      openCount = d.tasks.filter((t: { status: string }) => t.status === "open").length;
      completedCount = d.tasks.filter((t: { status: string }) => t.status === "completed").length;
    }
  } catch {}
  if (!boardOk) {
    notify("FAVOUR DOWN", "The board API is not responding");
    writeFileSync(TICKER, `---\ndate: ${ts.slice(0, 10)}\ntags: [favour, live]\nsource: watch-hourly\n---\n\n# FAVOUR live\n\n${ts}: BOARD DOWN — /api/tasks not responding.\n`);
    return;
  }

  // Event counters via admin analytics.
  const counts: State = { unlock_paid: 0, jury_verdict: 0, sign_in: 0, poll_vote: 0, prediction_stake: 0, completedCount };
  try {
    const res = await fetch(`${APP}/api/admin/analytics`, {
      headers: { Authorization: `Bearer ${process.env.ADMIN_SECRET}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const d = await res.json();
      const all = d.events?.allTime || d.events || {};
      counts.unlock_paid = Number(all.unlock_paid || 0);
      counts.jury_verdict = Number(all.jury_verdict || 0);
      counts.sign_in = Number(all.sign_in || 0);
      counts.poll_vote = Number(all.poll_vote || 0);
      counts.prediction_stake = Number(all.prediction_stake || 0);
    }
  } catch {}

  const lines: string[] = [];
  if (prev) {
    if (counts.unlock_paid > prev.unlock_paid) {
      notify("FAVOUR: UNLOCK PAID", "Someone unlocked real USDC through the clean gate");
      lines.push(`${ts}: UNLOCK PAID (#${counts.unlock_paid}) — real money moved through the clean gate.`);
    }
    if (counts.completedCount > prev.completedCount) lines.push(`${ts}: +${counts.completedCount - prev.completedCount} completions (now ${counts.completedCount}).`);
    if (counts.prediction_stake > prev.prediction_stake) lines.push(`${ts}: +${counts.prediction_stake - prev.prediction_stake} prediction stakes.`);
    if (counts.jury_verdict > prev.jury_verdict) lines.push(`${ts}: +${counts.jury_verdict - prev.jury_verdict} jury verdicts.`);
    if (counts.sign_in > prev.sign_in) lines.push(`${ts}: +${counts.sign_in - prev.sign_in} sign-ins.`);
  }

  writeFileSync(STATE, JSON.stringify(counts));

  // Ticker: header + last 48 delta lines (newest first), only appended when something happened.
  const header = `---\ndate: ${ts.slice(0, 10)}\ntags: [favour, live]\nsource: watch-hourly\n---\n\n# FAVOUR live\n\nLast check ${ts} — board OK, ${openCount} open, ${completedCount} completed. Totals: ${counts.jury_verdict} jury verdicts, ${counts.poll_vote} poll votes, ${counts.prediction_stake} stakes, ${counts.unlock_paid} unlocks.\n`;
  let history: string[] = [];
  if (existsSync(TICKER)) {
    const old = readFileSync(TICKER, "utf8");
    history = old.split("\n").filter((l) => /^\d{4}-\d{2}-\d{2}T/.test(l)).slice(0, 48);
  }
  writeFileSync(TICKER, header + "\n" + [...lines, ...history].slice(0, 48).join("\n") + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
