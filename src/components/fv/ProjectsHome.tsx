"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ProjectCard as Card, ProjectFilter } from "@/lib/projects-view";
import { filterProjects } from "@/lib/projects-view";
import { voteNote, type VoteReply } from "@/lib/apps-view";
import { ProjectCard } from "@/components/fv/ProjectCard";
import { SignInSheet } from "@/components/fv/SignInSheet";
import { displayName, useWorldUsers } from "@/hooks/useWorldUser";

// THE HOME SCREEN (FAVOUR revamp, 19 Oct 2026). Builders post what they vibe
// coded. Humans pick a project, try it, say YES, and give feedback for points.
// Signed-out visitors see everything; the sign-in sheet opens at the first tap
// that needs a wallet. The old board is one link away at /board.

export type HomeAuth = {
  userId: string | null;
  isInWorldApp: boolean;
  isVerifying: boolean;
  authError: string | null;
  onVerify: () => void;
};

const FILTERS: Array<{ key: ProjectFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "waiting", label: "Waiting for YES" },
  { key: "live", label: "Live" },
];

export function ProjectsHomeView({ projects, error, filter, onFilter, notes, busy, onYes, signedInAs, onSignIn }: {
  projects: Card[] | null;
  error: string | null;
  filter: ProjectFilter;
  onFilter: (f: ProjectFilter) => void;
  notes: Record<string, string>;
  busy: string | null;
  onYes: (id: string) => void;
  signedInAs: string | null;
  onSignIn: () => void;
}) {
  const shown = projects ? filterProjects(projects, filter) : null;
  const waiting = projects?.filter((p) => p.status === "pending").length ?? 0;
  const live = projects?.filter((p) => p.status === "published").length ?? 0;
  return (
    <div className="fv min-h-screen max-w-lg mx-auto">
      <header className="sticky top-0 z-10 fv-rule-b bg-white px-6 py-3 flex items-center justify-between gap-3">
        <h1 className="fv-h">FAVOUR</h1>
        {signedInAs ? (
          <Link href="/dashboard" className="fv-body underline underline-offset-2 truncate max-w-[50%]">{signedInAs}</Link>
        ) : (
          <button type="button" onClick={onSignIn} className="fv-body underline underline-offset-2 min-h-[44px]">Sign in</button>
        )}
      </header>

      <section className="px-6 pt-6 pb-5 flex flex-col gap-4 fv-rule-b">
        <p className="fv-title">Real humans try what you vibe coded.</p>
        <p className="fv-body">Builders post an app. You try it and say YES. Ten YES puts it live. Then your feedback earns points.</p>
        <Link href="/post" className="fv-btn fv-btn-ink">Post your app</Link>
        {projects && (
          <p className="fv-body fv-num text-[12px]">
            {waiting} waiting for YES · {live} live · <Link href="/board" className="underline underline-offset-2">All favours</Link>
          </p>
        )}
      </section>

      <nav aria-label="Filter projects" className="px-6 py-3 flex gap-2 fv-rule-b">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="fv-chip" aria-pressed={filter === f.key} onClick={() => onFilter(f.key)}>{f.label}</button>
        ))}
      </nav>

      <div className="px-6 py-5 pb-28 flex flex-col gap-5">
        {error && <p role="alert" className="fv-body">{error}</p>}
        {!error && shown === null && <p className="fv-body">Reading the list…</p>}
        {!error && shown?.length === 0 && (
          <div className="fv-box p-5 flex flex-col gap-3">
            <p className="fv-h">{filter === "live" ? "Nothing is live yet" : "No project is waiting"}</p>
            <p className="fv-body">Built something? Post it and ask ten people to try it.</p>
            <Link href="/post" className="fv-btn">Post your app</Link>
          </div>
        )}
        {shown?.map((p) => <ProjectCard key={p.id} p={p} busy={busy === p.id} note={notes[p.id]} onYes={onYes} />)}
      </div>
    </div>
  );
}

export function ProjectsHome({ auth }: { auth: HomeAuth }) {
  const [projects, setProjects] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ why: string; then: (() => void) | null } | null>(null);

  const addresses = useMemo(() => (auth.userId ? [auth.userId] : []), [auth.userId]);
  useWorldUsers(addresses);

  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(body?.projects)) throw new Error(body?.error ?? "The list could not be read. Try again.");
        setProjects(body.projects);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Signed in during a sheet: run the tap that opened it, once.
  useEffect(() => {
    if (auth.userId && sheet) { const then = sheet.then; setSheet(null); then?.(); }
  }, [auth.userId, sheet]);

  const castYes = useCallback(async (id: string) => {
    setBusy(id);
    let reply: VoteReply = null;
    try {
      const r = await fetch("/api/apps/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      reply = await r.json().catch(() => null);
    } catch {
      reply = null;
    }
    if (reply && "ok" in reply && reply.ok) {
      const { yes, status } = reply;
      setProjects((list) => list?.map((p) => (p.id === id ? { ...p, yes, status } : p)) ?? list);
    }
    setNotes((n) => ({ ...n, [id]: voteNote(reply) }));
    setBusy(null);
  }, []);

  const onYes = useCallback((id: string) => {
    if (!auth.userId) { setSheet({ why: "Sign in to say YES.", then: () => castYes(id) }); return; }
    castYes(id);
  }, [auth.userId, castYes]);

  return (
    <>
      <ProjectsHomeView
        projects={projects}
        error={error}
        filter={filter}
        onFilter={setFilter}
        notes={notes}
        busy={busy}
        onYes={onYes}
        signedInAs={auth.userId ? displayName(auth.userId) : null}
        onSignIn={() => setSheet({ why: "Sign in to take part.", then: null })}
      />
      {sheet && !auth.userId && (
        <div className="fv">
          <SignInSheet why={sheet.why} isInWorldApp={auth.isInWorldApp} busy={auth.isVerifying} error={auth.authError} onSignIn={auth.onVerify} onClose={() => setSheet(null)} />
        </div>
      )}
    </>
  );
}
