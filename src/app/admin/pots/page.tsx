"use client";

import { useEffect, useState } from "react";
import { MiniKit } from "@worldcoin/minikit-js";

/**
 * Admin pots: open a campaign pot, fund it from World App (Permit2), pay a favour from it.
 * Every call goes to /api/admin/pots with the admin secret; the secret stays in this tab only.
 */

type Pot = {
  campaignId: string;
  balanceUsd: string;
  capUsd: string;
  totalFundedUsd: string;
  feeBps: number;
  closed: boolean;
  frozen: boolean;
  feesWaitingUsd?: string;
};

async function call(secret: string, body: Record<string, unknown>) {
  const res = await fetch("/api/admin/pots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Error ${res.status}`);
  return data;
}

export default function AdminPotsPage() {
  const [secret, setSecret] = useState("");
  const [potId, setPotId] = useState("");
  const [pot, setPot] = useState<Pot | null>(null);
  const [cap, setCap] = useState("5");
  const [fundAmount, setFundAmount] = useState("1");
  const [payFavour, setPayFavour] = useState("");
  const [payTo, setPayTo] = useState("");
  const [payAmount, setPayAmount] = useState("0.1");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    try {
      setSecret(sessionStorage.getItem("favour_admin_secret") || "");
      const fromUrl = new URLSearchParams(window.location.search).get("pot");
      setPotId(fromUrl || localStorage.getItem("favour_admin_pot") || "");
    } catch { /* storage blocked */ }
  }, []);

  const remember = (s: string, id: string) => {
    try {
      sessionStorage.setItem("favour_admin_secret", s);
      localStorage.setItem("favour_admin_pot", id);
    } catch { /* storage blocked */ }
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(null);
    }
  };

  const refresh = (id = potId) =>
    run("status", async () => {
      const d = await call(secret, { action: "status", campaignId: id });
      setPot(d);
    });

  const openPot = () =>
    run("open", async () => {
      const d = await call(secret, { action: "open", capUsd: Number(cap) });
      setPotId(d.campaignId);
      remember(secret, d.campaignId);
      setNote({ ok: true, text: `Pot #${d.campaignId} opened. Now fund it.` });
      const s = await call(secret, { action: "status", campaignId: d.campaignId });
      setPot(s);
    });

  const fundPot = () =>
    run("fund", async () => {
      if (!MiniKit.isInstalled()) throw new Error("Open FAVOUR inside World App to fund the pot.");
      const before = pot?.balanceUsd;
      const d = await call(secret, { action: "prepare-fund", campaignId: potId, amountUsd: Number(fundAmount) });
      const signed = await MiniKit.sendTransaction(d.payload);
      if (!signed) throw new Error("Not signed. Nothing moved.");
      setNote({ ok: true, text: "Signed. Waiting for World Chain..." });
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const s = await call(secret, { action: "status", campaignId: potId });
        if (s.balanceUsd !== before) {
          setPot(s);
          setNote({ ok: true, text: `Pot #${potId} now holds ${s.balanceUsd} USDC.` });
          return;
        }
      }
      throw new Error("World Chain has not confirmed it yet. Refresh in a minute.");
    });

  const pay = () =>
    run("pay", async () => {
      const d = await call(secret, {
        action: "pay",
        campaignId: potId,
        favour: payFavour,
        recipient: payTo.trim(),
        amountUsd: Number(payAmount),
      });
      setNote({ ok: true, text: `Paid ${d.paidUsd} USDC to the helper. Fee ${d.feeUsd} USDC ${d.feeTx ? "sent to the fee address" : "waiting in the contract"}.` });
      await refresh();
    });

  const field = "w-full rounded-xl border border-gray-200 px-3 py-2 text-sm";
  const btn = "w-full rounded-xl bg-gray-900 text-white py-3 text-sm font-semibold disabled:opacity-40";
  const feePct = pot ? (pot.feeBps / 100).toFixed(1) : "2.5";
  const net = (Number(payAmount) * (1 - (pot?.feeBps ?? 250) / 10000)).toFixed(4);

  return (
    <main className="max-w-lg mx-auto p-4 flex flex-col gap-5">
      <h1 className="text-xl font-bold">Campaign pots</h1>

      <section className="flex flex-col gap-2">
        <label className="text-xs text-gray-500">Admin secret</label>
        <input className={field} type="password" value={secret} onChange={(e) => { setSecret(e.target.value); remember(e.target.value, potId); }} />
      </section>

      <section className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm font-semibold">1. Open a pot</p>
        <label className="text-xs text-gray-500">Max per favour (USDC)</label>
        <input className={field} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
        <button className={btn} disabled={!secret || !!busy} onClick={openPot}>{busy === "open" ? "Opening..." : "Open pot"}</button>
      </section>

      <section className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm font-semibold">Pot</p>
        <div className="flex gap-2">
          <input className={field} placeholder="Pot number" value={potId} onChange={(e) => { setPotId(e.target.value); remember(secret, e.target.value); }} />
          <button className="rounded-xl border px-4 text-sm" disabled={!potId || !!busy} onClick={() => refresh()}>Load</button>
        </div>
        {pot && (
          <p className="text-sm text-gray-700">
            Pot #{pot.campaignId}: {pot.balanceUsd} USDC, max {pot.capUsd} per favour, fee {feePct}%{pot.frozen ? ", frozen" : ""}{pot.closed ? ", closed" : ""}.
            {pot.feesWaitingUsd && pot.feesWaitingUsd !== "0.00" ? ` Fees waiting: ${pot.feesWaitingUsd} USDC.` : ""}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm font-semibold">2. Fund the pot from World App</p>
        <input className={field} inputMode="decimal" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
        <button className={btn} disabled={!potId || !!busy} onClick={fundPot}>{busy === "fund" ? "Waiting..." : `Fund ${fundAmount} USDC`}</button>
      </section>

      <section className="flex flex-col gap-2 border-t pt-4">
        <p className="text-sm font-semibold">3. Pay a favour from the pot</p>
        <input className={field} placeholder="Favour (task id or name, each pays once)" value={payFavour} onChange={(e) => setPayFavour(e.target.value)} />
        <input className={field} placeholder="Helper wallet 0x..." value={payTo} onChange={(e) => setPayTo(e.target.value)} />
        <input className={field} inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
        <p className="text-xs text-gray-500">Helper receives {net} USDC. FAVOUR fee {feePct}% is taken at payout, never on deposit.</p>
        <button className={btn} disabled={!secret || !potId || !payFavour || !payTo || !!busy} onClick={pay}>{busy === "pay" ? "Paying..." : "Pay helper"}</button>
      </section>

      {note && <p className={`text-sm ${note.ok ? "text-green-700" : "text-red-600"}`}>{note.text}</p>}
    </main>
  );
}
