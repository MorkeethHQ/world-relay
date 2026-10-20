import Link from "next/link";
import { funkyArt } from "@/lib/funky-art";

const projects = [
  ["STRIVE", "Share an agent run as a clear, useful story.", "/story/strive"],
  ["Transcripto", "See what your prompt history can teach you.", "/story/transcripto"],
  ["Oscar Labs", "Experiments shown with their evidence attached.", "/story/oscar-labs"],
];

export default function DropPage() {
  return <div className="curated min-h-screen"><header className="curated-header"><Link href="/" className="curated-wordmark">Favour</Link><nav className="curated-links"><Link href="/">Discover</Link><Link href="/apps">All projects</Link><Link href="/post" className="curated-submit">Submit a project</Link></nav></header><main>
    <section className="drop-intro"><p className="curated-eyebrow">Drop 04 · 20 October</p><h1>Three tools made for people who work with AI.</h1><p>Selected for a clear job, an honest story and something you can try today.</p></section>
    <section className="drop-list">{projects.map((p, i) => <Link href={p[2]} className="drop-row" key={p[0]}><span className="drop-index">0{i + 1}</span><img src={funkyArt(p[0])} alt="" /><div><p className="curated-eyebrow">Featured project</p><h2>{p[0]}</h2><p>{p[1]}</p><span>Meet the builder →</span></div></Link>)}</section>
    <section className="curated-cta"><p>Next drop · Monday</p><h2>Want to be considered?</h2><Link href="/post">Submit your project →</Link></section>
  </main></div>;
}
