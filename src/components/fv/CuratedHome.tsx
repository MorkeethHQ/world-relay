"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ProjectCard } from "@/lib/projects-view";
import { funkyArt } from "@/lib/funky-art";

const editorial = [
  { name: "STRIVE", line: "A clearer way to share what your agent actually did.", href: "/story/strive", tag: "Builder story" },
  { name: "Transcripto", line: "A small tool that turns prompt history into useful feedback.", href: "/story/transcripto", tag: "From the workshop" },
  { name: "Oscar Labs", line: "Experiments, evidence and the honest parts between launches.", href: "/story/oscar-labs", tag: "Studio visit" },
];

function Cover({ name, src, className = "" }: { name: string; src?: string | null; className?: string }) {
  return <img src={src || funkyArt(name)} alt="" className={`curated-cover ${className}`} />;
}

export function CuratedHome() {
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => setProjects(Array.isArray(body?.projects) ? body.projects : []))
      .catch(() => setProjects([]));
  }, []);
  const featured = useMemo(() => projects.slice(0, 4), [projects]);

  return (
    <div className="curated min-h-screen">
      <header className="curated-header">
        <Link href="/" className="curated-wordmark">Favour</Link>
        <nav aria-label="Primary" className="curated-links">
          <Link href="/drop/2026-w43">This week</Link>
          <Link href="/apps">All projects</Link>
          <Link href="/post" className="curated-submit">Submit a project</Link>
        </nav>
      </header>

      <main>
        <section className="curated-hero">
          <div className="curated-hero-copy">
            <p className="curated-kicker"><span /> Curated every Monday</p>
            <h1>New tools, tried by real people.</h1>
            <p className="curated-deck">A weekly selection of early products, thoughtful feedback, and the people building them.</p>
            <p className="curated-verified"><span>✓</span> Feedback tied to a verified World wallet</p>
            <div className="curated-hero-actions">
              <Link href="/drop/2026-w43" className="curated-primary">Explore this week’s drop</Link>
              <Link href="/post" className="curated-secondary">Get your project featured</Link>
            </div>
          </div>
          <Link href="/story/strive" className="curated-hero-project"><p>Featured this week</p><Cover name="STRIVE" /><div><b>STRIVE</b><span>A clearer way to share an agent run.</span></div></Link>
        </section>

        <section className="curated-drop">
          <div className="curated-section-head">
            <div><p className="curated-eyebrow">Drop 04 · 20 October</p><h2>This week’s projects</h2></div>
            <Link href="/drop/2026-w43">View the full drop <span>→</span></Link>
          </div>
          <div className="curated-grid">
            {(featured.length ? featured : editorial.slice(0, 3).map((x, i) => ({ id: `seed-${i}`, name: x.name, ask: x.line, image: null, status: "pending" as const, yes: i + 3, of: 10 }))).map((p, i) => (
              <Link href={("id" in p && !String(p.id).startsWith("seed-")) ? `/project/${encodeURIComponent(p.id)}` : editorial[i]?.href || "/apps"} className={`curated-project ${i === 0 ? "curated-project-featured" : ""}`} key={p.id}>
                <Cover name={p.name} src={p.image} />
                <div className="curated-project-copy">
                  <p className="curated-project-number">0{i + 1}</p>
                  <div><h3>{p.name}</h3><p>{p.ask}</p></div>
                  <span className="curated-arrow">↗</span>
                </div>
                <div className="curated-trust"><span className="curated-people">● ● ●</span><span>{p.status === "published" ? "Human reviewed" : `${p.yes} of ${p.of} people tried it`}</span></div>
              </Link>
            ))}
          </div>
        </section>

        <section className="curated-story-band">
          <div className="curated-section-head curated-section-head-light">
            <div><p className="curated-eyebrow">Behind the build</p><h2>Builder stories</h2></div>
            <p>The choices, setbacks and small breakthroughs behind early products.</p>
          </div>
          <div className="curated-stories">
            {editorial.map((story) => (
              <Link href={story.href} className="curated-story-card" key={story.name}>
                <Cover name={story.name} />
                <p className="curated-story-tag">{story.tag}</p>
                <h3>{story.name}</h3>
                <p>{story.line}</p>
                <span>Read the story →</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="curated-how">
          <p className="curated-eyebrow">Why Favour</p>
          <h2>Feedback from people who used the product.</h2>
          <div className="curated-how-grid">
            <div><b>01</b><h3>We choose carefully</h3><p>A small weekly drop, not an endless feed.</p></div>
            <div><b>02</b><h3>People try the product</h3><p>Feedback starts with use, not a quick impression.</p></div>
            <div><b>03</b><h3>Builders get useful notes</h3><p>Clear responses tied to a real product journey.</p></div>
          </div>
        </section>

        <section className="curated-cta"><p>Building something worth trying?</p><h2>Tell us the story.</h2><Link href="/post">Submit your project →</Link></section>
      </main>
    </div>
  );
}
