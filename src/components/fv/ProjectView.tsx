"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProjectCard as Card } from "@/lib/projects-view";
import { countLine } from "@/lib/projects-view";
import type { CampaignResult } from "@/lib/campaign-draft-shape";
import { PIECE_LABEL } from "@/lib/campaign-draft-shape";
import { voteNote, type VoteReply } from "@/lib/apps-view";
import { TenHumans } from "@/components/fv/TenHumans";
import { SignInSheet } from "@/components/fv/SignInSheet";
import { PaySlots } from "@/components/fv/PaySlots";

// ONE PROJECT (FAVOUR revamp, 19 Oct 2026). Waiting: open it, say YES. Live: its
// favours, each a piece that pays points, and the reviewed work so far.

const VERDICT_LABEL: Record<CampaignResult["verdict"], string> = { pass: "Accepted", fail: "Not accepted", flag: "Under review" };

export function ProjectViewScreen({ p, results, note, busy, onYes, signedIn, paid }: {
  p: Card; results: CampaignResult[]; note: string | null; busy: boolean; onYes: () => void; signedIn: boolean; paid?: React.ReactNode;
}) {
  const live = p.status === "published";
  return (
    <div className="fv min-h-screen max-w-lg mx-auto">
      <header className="sticky top-0 z-10 fv-rule-b bg-white px-6 py-3 flex items-center gap-3">
        <Link href="/" aria-label="Back" className="min-h-[44px] min-w-[44px] -ml-3 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter"><polyline points="15 18 9 12 15 6" /></svg>
        </Link>
        <p className="fv-h flex-1 min-w-0 truncate">{p.name}</p>
        <p className={`fv-h fv-num shrink-0 ${live ? "" : "fv-blue"}`}>{countLine(p)}</p>
      </header>

      {p.fromOtherSource && <p className="fv-banner fv-label fv-rule-b">Found elsewhere. Not posted by its builder.</p>}
      {p.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt="" className="fv-pic" />
      )}

      <div className="px-6 py-5 pb-28 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className={`fv-title break-words ${p.fromOtherSource ? "fv-frame" : ""}`}>{p.name}</h1>
          {p.host && <a href={p.url} target="_blank" rel="noopener noreferrer" className="fv-body underline underline-offset-2 break-all">{p.host}</a>}
          <p className="fv-body break-words">{p.ask}</p>
        </div>

        <section aria-label="Ten humans" className="flex flex-col gap-2">
          <TenHumans yes={p.yes} of={p.of} big />
          <p className="fv-body fv-num">{live ? "Ten humans said YES. It is live." : `${p.yes} of ${p.of} humans said YES. Ten puts it live.`}</p>
        </section>

        {!live && (
          <div className="flex flex-col gap-2">
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="fv-btn">Open the app</a>
            <button type="button" disabled={busy} aria-label={`Say YES to ${p.name}`} onClick={onYes} className="fv-btn fv-btn-ink">
              {signedIn ? "YES, it works" : "Sign in and say YES"}
            </button>
            {note && <p role="status" className="fv-body">{note}</p>}
            <p className="fv-body text-[12px]">A YES pays nothing and moves no money. One per wallet. Your own app does not count.</p>
          </div>
        )}

        {live && (
          <section aria-label="Favours for this project" className="flex flex-col gap-3">
            <h2 className="fv-label">Favours · {p.points} points each</h2>
            {p.pieces.length === 0 && <p className="fv-body">No favour is open on this project yet.</p>}
            {p.pieces.length > 0 && p.pieces.every((x) => !x.open) && <p className="fv-body">Every favour on this project is closed for now.</p>}
            {p.pieces.map((piece) => (
              <div key={piece.kind} className="fv-box p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="fv-h">{PIECE_LABEL[piece.kind]}</p>
                  <p className="fv-body text-[12px] fv-num">{piece.open ? `${piece.left} of ${piece.count} still wanted` : "Closed"}</p>
                </div>
                {piece.open && piece.taskId ? (
                  <Link href={`/project/${encodeURIComponent(p.id)}/feedback?task=${encodeURIComponent(piece.taskId)}`} className="fv-btn fv-btn-sm fv-btn-ink">Give feedback</Link>
                ) : (
                  <span className="fv-body text-[12px]">Not open</span>
                )}
              </div>
            ))}
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="fv-btn">Open the app</a>
          </section>
        )}

        {live && paid}

        {live && (
          <section aria-label="Reviewed work" className="flex flex-col gap-2">
            <h2 className="fv-label">Reviewed work</h2>
            {results.length === 0 ? <p className="fv-body">Nothing reviewed yet.</p> : results.map((r) => (
              <div key={`${r.taskId}-${r.at}`} className="fv-box px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="fv-label">{VERDICT_LABEL[r.verdict]}</span>
                  <span className="fv-body text-[12px]">{r.kind ? PIECE_LABEL[r.kind] : "Piece"} · {r.participant}</span>
                </div>
                <p className="fv-body mt-1 line-clamp-3 break-words">{r.reason}</p>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

export function ProjectView({ id, userId, isInWorldApp, isVerifying, authError, onVerify }: {
  id: string; userId: string | null; isInWorldApp: boolean; isVerifying: boolean; authError: string | null; onVerify: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<{ project: Card; results: CampaignResult[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [paySheet, setPaySheet] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !body?.project) throw new Error(r.status === 404 ? "This project is not on FAVOUR." : body?.error ?? "The project could not be read. Try again.");
        setData(body);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const castYes = useCallback(async () => {
    setBusy(true);
    let reply: VoteReply = null;
    try {
      const r = await fetch("/api/apps/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      reply = await r.json().catch(() => null);
    } catch { reply = null; }
    if (reply && "ok" in reply && reply.ok) {
      const { yes, status } = reply;
      setData((d) => (d ? { ...d, project: { ...d.project, yes, status } } : d));
      if (status === "published") router.refresh();
    }
    setNote(voteNote(reply));
    setBusy(false);
  }, [id, router]);

  useEffect(() => { if (userId && sheet) { setSheet(false); castYes(); } }, [userId, sheet, castYes]);
  useEffect(() => { if (userId && paySheet) setPaySheet(false); }, [userId, paySheet]);

  if (error) return <div className="fv min-h-screen max-w-lg mx-auto px-6 py-8 flex flex-col gap-4"><p className="fv-body" role="alert">{error}</p><Link href="/" className="fv-btn">Back to projects</Link></div>;
  if (!data) return <div className="fv min-h-screen max-w-lg mx-auto px-6 py-8"><p className="fv-body">Reading the project…</p></div>;
  return (
    <>
      <ProjectViewScreen p={data.project} results={data.results} note={note} busy={busy} signedIn={!!userId} onYes={() => (userId ? castYes() : setSheet(true))}
        paid={<PaySlots projectId={id} userId={userId} onNeedSignIn={() => setPaySheet(true)} />} />
      {sheet && !userId && (
        <div className="fv"><SignInSheet why="Sign in to say YES." isInWorldApp={isInWorldApp} busy={isVerifying} error={authError} onSignIn={onVerify} onClose={() => setSheet(false)} /></div>
      )}
      {paySheet && !userId && (
        <div className="fv"><SignInSheet why="Sign in to take a paid review." isInWorldApp={isInWorldApp} busy={isVerifying} error={authError} onSignIn={onVerify} onClose={() => setPaySheet(false)} /></div>
      )}
    </>
  );
}
