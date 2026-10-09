"use client";

import { useState, useEffect } from "react";
import { Button, Card, Counts, Heading, Note, Screen } from "@/components/Kit";

// HISTORY (9 Oct 2026, Oscar: "history is good, i like the banner of people
// reached etc for favour, but the rest can go actually"). One word, then the
// three platform counts in one white card, drawn only when the server gave all
// three. Then one quiet row to the old polls and predictions, because the
// prediction archive holds existing stakes. The result lists that were here are
// unmounted, not deleted: their routes and libs stand, and a person's own
// results stay on Profile.
type Stats = {
  users?: { total?: number; verified?: number; reached?: number };
  volume?: { paidOutUsdc?: number; pointsDistributed?: number };
};

export default function HistoryPage() {
  // null until the server answered: an unknown total is not shown as zero.
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d === "object" && !d.error) setStats(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const paid = stats?.volume?.paidOutUsdc;
  const points = stats?.volume?.pointsDistributed;
  const people = stats?.users?.reached ?? stats?.users?.verified;
  const known = typeof paid === "number" && typeof points === "number" && typeof people === "number";

  return (
    <Screen label="History">
      <Heading size="display">History</Heading>

      {loading ? (
        <Note kind="loading" quiet>Reading…</Note>
      ) : known ? (
        <Card label="FAVOUR totals">
          <Counts items={[
            { n: Math.round(paid), label: "USDC paid out" },
            { n: Math.round(points), label: "points, closed favours" },
            { n: people, label: "people reached" },
          ]} />
        </Card>
      ) : (
        <Note quiet>FAVOUR&apos;s totals could not be read.</Note>
      )}

      {/* The prediction archive holds existing stakes, so the old page stays reachable from here. */}
      <div style={{ marginTop: 24 }}>
        <Button kind="quiet" wide href="/polls">Old polls and predictions</Button>
      </div>
    </Screen>
  );
}
