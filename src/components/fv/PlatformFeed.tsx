"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlatformPostKind, PublicPlatformPost } from "@/lib/platform-posts";
import { useFavourAuth } from "@/hooks/useFavourAuth";
import { SignInSheet } from "./SignInSheet";

const LABEL: Record<PlatformPostKind, string> = {
  build: "What I’m building",
  agent_problem: "Agent problem",
};

const LOCAL_PREVIEW = process.env.NEXT_PUBLIC_FAVOUR_TEST_FIXTURE === "1";
const PREVIEW_POSTS: PublicPlatformPost[] = [
  {
    id: "preview-build",
    kind: "build",
    title: "I’m building a better agent review loop",
    body: "The product shows the work, asks people to try it and turns useful feedback into a paid favour.",
    projectUrl: "https://example.com",
    author: "p_preview_01",
    createdAt: "2026-10-20T10:00:00.000Z",
    moderation: "published",
    likes: 18,
    likedByYou: false,
  },
  {
    id: "preview-problem",
    kind: "agent_problem",
    title: "My agent fixes the task but loses the goal",
    body: "The code passes. The result still answers a smaller question than the one I asked.",
    projectUrl: null,
    author: "p_preview_02",
    createdAt: "2026-10-20T09:00:00.000Z",
    moderation: "published",
    likes: 31,
    likedByYou: true,
  },
];

export function PlatformFeed() {
  const auth = useFavourAuth();
  const [posts, setPosts] = useState<PublicPlatformPost[] | null>(null);
  const [kind, setKind] = useState<PlatformPostKind>("build");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectUrl, setProjectUrl] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => LOCAL_PREVIEW ? Promise.resolve(setPosts(PREVIEW_POSTS)) : fetch("/api/platform/posts", { cache: "no-store" })
    .then((response) => response.json())
    .then((value) => setPosts(Array.isArray(value.posts) ? value.posts : [])), []);

  useEffect(() => { load().catch(() => setPosts([])); }, [load]);
  useEffect(() => {
    if (auth.userId && sheet) {
      setSheet(null);
      setShowComposer(true);
    }
  }, [auth.userId, sheet]);

  const start = () => {
    if (auth.userId || LOCAL_PREVIEW) setShowComposer(true);
    else setSheet("Sign in with World to share what you are building.");
  };

  const publish = async () => {
    setBusy(true);
    setNotice(null);
    const response = await fetch("/api/platform/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, title, body, projectUrl }),
    });
    const value = await response.json().catch(() => ({}));
    if (response.ok && value.post) {
      setPosts((current) => [value.post, ...(current ?? [])]);
      setTitle("");
      setBody("");
      setProjectUrl("");
      setShowComposer(false);
    } else {
      setNotice(value.error ?? "The post was not saved.");
    }
    setBusy(false);
  };

  const like = async (id: string) => {
    if (auth.userId === null) {
      setSheet("Sign in with World to like this post.");
      return;
    }
    const response = await fetch(`/api/platform/posts/${encodeURIComponent(id)}/like`, { method: "POST" });
    const value = await response.json().catch(() => ({}));
    if (response.ok) {
      setPosts((all) => all?.map((post) => post.id === id ? { ...post, likes: value.likes, likedByYou: true } : post) ?? all);
    } else {
      setNotice(value.error ?? "The like was not saved.");
    }
  };

  return <div className="fv min-h-screen max-w-lg mx-auto bg-white">
    <header className="sticky top-0 z-10 bg-white fv-rule-b px-5 h-14 flex items-center justify-between">
      <h1 className="fv-h">FAVOUR</h1>
      <button className="fv-body underline underline-offset-2 min-h-[44px]" onClick={start}>New post</button>
    </header>
    <section className="px-5 py-6 fv-rule-b flex flex-col gap-3">
      <p className="fv-label">Builder feed</p>
      <h2 className="fv-title">What are you building?</h2>
      <p className="fv-body">Follow new work and the problems people keep having with their agents.</p>
      <button className="fv-btn fv-btn-ink" onClick={start}>Share something</button>
    </section>
    {showComposer && <section className="px-5 py-5 fv-rule-b flex flex-col gap-3" aria-label="New post">
      <div className="flex gap-2">{(["build", "agent_problem"] as PlatformPostKind[]).map((item) =>
        <button key={item} className="fv-chip" aria-pressed={kind === item} onClick={() => setKind(item)}>{LABEL[item]}</button>)}</div>
      <input className="fv-field" value={title} maxLength={90} placeholder={kind === "build" ? "What are you building?" : "What did the agent get wrong?"} onChange={(event) => setTitle(event.target.value)} />
      <textarea className="fv-field min-h-28" value={body} maxLength={800} placeholder="Give people enough context to respond." onChange={(event) => setBody(event.target.value)} />
      {kind === "build" && <input className="fv-field" value={projectUrl} placeholder="https://project.example (optional)" onChange={(event) => setProjectUrl(event.target.value)} />}
      <div className="flex gap-2">
        <button className="fv-btn fv-btn-sm" onClick={() => setShowComposer(false)}>Cancel</button>
        <button className="fv-btn fv-btn-sm fv-btn-ink flex-1" disabled={busy || title.trim().length === 0 || body.trim().length === 0} onClick={publish}>{busy ? "Posting…" : "Post"}</button>
      </div>
    </section>}
    {notice && <p role="alert" className="px-5 py-3 fv-body fv-rule-b">{notice}</p>}
    <div className="pb-24">
      {posts === null && <p className="p-5 fv-body">Reading the feed…</p>}
      {posts?.length === 0 && <div className="p-5"><div className="fv-box p-5 flex flex-col gap-2"><p className="fv-h">No posts yet</p><p className="fv-body">Share a build or a specific agent problem.</p></div></div>}
      {posts?.map((post) => <article key={post.id} className="px-5 py-5 fv-rule-b flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3"><span className="fv-label fv-blue">{LABEL[post.kind]}</span><span className="fv-body text-[12px]">{post.author}</span></div>
        <div><h3 className="fv-h text-[20px]">{post.title}</h3><p className="fv-body mt-2 whitespace-pre-wrap">{post.body}</p></div>
        {post.projectUrl && <a className="fv-body underline underline-offset-2 break-all" href={post.projectUrl} target="_blank" rel="noreferrer">Open the project</a>}
        <div className="flex items-center gap-3">
          <button className="fv-chip" data-on={post.likedByYou ? "true" : "false"} onClick={() => like(post.id)}>{post.likedByYou ? "Liked" : "Like"} · {post.likes}</button>
          <span className="fv-body text-[12px]">Replies come next</span>
        </div>
      </article>)}
    </div>
    {sheet && auth.userId === null && <SignInSheet why={sheet} isInWorldApp={auth.isInWorldApp} busy={auth.isVerifying} error={auth.authError} onSignIn={auth.signIn} onClose={() => setSheet(null)} />}
  </div>;
}
