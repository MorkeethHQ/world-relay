import Link from "next/link";
import { notFound } from "next/navigation";
import { funkyArt } from "@/lib/funky-art";

const stories = {
  strive: { name: "STRIVE", dek: "Making an agent run readable to someone who was not there.", maker: "Oscar", url: "https://striverun.app", paragraphs: ["Agent work is usually trapped in terminals and logs. STRIVE turns one run into a card that can be read, checked and shared.", "The design question was not how to show more data. It was how to show the decision, the evidence and what happened next without losing the thread.", "The next test is simple: can a stranger understand one consequential run without an explanation from the builder?"] },
  transcripto: { name: "Transcripto", dek: "A prompt-history tool that looks for useful patterns in the work.", maker: "Oscar", url: "https://pypi.org/project/transcripto", paragraphs: ["Prompt history is normally treated as exhaust. Transcripto starts from a different idea: the way you ask may reveal where the work keeps getting stuck.", "It runs on your own sessions and turns repeated patterns into feedback you can inspect.", "The aim is not a score for its own sake. It is a clearer next move for the person doing the work."] },
  "oscar-labs": { name: "Oscar Labs", dek: "A public home for experiments, including the parts that did not work.", maker: "Oscar", url: "https://oscar-labs.vercel.app", paragraphs: ["Most product stories begin after the answer is known. Oscar Labs keeps the experiment, evidence and correction together.", "That makes the work useful beyond the announcement. A reader can see what was tried, what changed and what is still uncertain.", "The result is less like a portfolio and more like an open workshop."] },
} as const;

export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const story = stories[slug as keyof typeof stories]; if (!story) notFound();
  return <div className="curated min-h-screen"><header className="curated-header"><Link href="/" className="curated-wordmark">Favour</Link><nav className="curated-links"><Link href="/drop/2026-w43">This week</Link><Link href="/apps">All projects</Link><Link href="/post" className="curated-submit">Submit a project</Link></nav></header><main className="story-page">
    <p className="curated-eyebrow">Builder story · 6 min read</p><h1>{story.name}</h1><p className="story-dek">{story.dek}</p>
    <img src={funkyArt(story.name)} alt="" className="story-hero" />
    <div className="story-meta"><div><span>Built by</span><b>{story.maker}</b></div><div><span>Selected for</span><b>Drop 04</b></div><a href={story.url} target="_blank" rel="noreferrer">Open the project ↗</a></div>
    <article>{story.paragraphs.map((p, i) => <section key={p}><span>0{i + 1}</span><p>{p}</p></section>)}</article>
    <aside><p className="curated-eyebrow">Try it properly</p><h2>Use the product, then leave feedback the builder can act on.</h2><Link href="/apps">Find it on Favour →</Link></aside>
  </main></div>;
}
