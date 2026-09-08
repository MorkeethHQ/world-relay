"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

export default function NewCampaignPage() {
  const [address, setAddress] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mediaDataUrl, setMediaDataUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/session")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setAddress(data?.address || null))
      .finally(() => setLoadingSession(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address) return;
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requester: address,
        requesterName: form.get("requesterName"),
        requesterKind: form.get("requesterKind"),
        name: form.get("name"),
        ask: form.get("ask"),
        category: form.get("category"),
        completion: String(form.get("completion") || "").split("\n"),
        proof: form.get("proof"),
        repeats: form.get("repeats"),
        rewardPoints: Number(form.get("rewardPoints")),
        completionsPerCycle: Number(form.get("completionsPerCycle")),
        intervalHours: Number(form.get("intervalHours")),
        totalCycles: Number(form.get("totalCycles")),
        location: form.get("location"),
        mediaDataUrl,
        mediaAlt: form.get("mediaAlt"),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || "Campaign creation failed.");
      setSubmitting(false);
      return;
    }
    window.location.assign(`/c/${data.campaign.id}`);
  }

  if (loadingSession) return <main className="mx-auto max-w-lg p-6 text-sm text-gray-500">Checking your verified session…</main>;
  if (!address) return (
    <main className="mx-auto min-h-screen max-w-lg bg-gray-50 p-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h1 className="text-xl font-bold text-gray-950">Verify before you commission work</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">Campaigns create recurring public work. Open FAVOUR and sign in with your wallet first.</p>
        <Link href="/" className="mt-5 flex min-h-12 items-center justify-center rounded-xl bg-gray-950 font-semibold text-white">Sign in</Link>
      </div>
    </main>
  );

  const input = "mt-1.5 min-h-12 w-full rounded-xl border border-gray-200 bg-white px-3 text-[15px] text-gray-950 outline-none focus:border-gray-900";
  const textarea = `${input} py-3 leading-relaxed`;
  return (
    <main className="mx-auto min-h-screen max-w-lg bg-gray-50 pb-28">
      <header className="bg-gray-950 px-5 pb-6 pt-4 text-white">
        <Link href="/" className="text-sm text-white/70 underline underline-offset-2">← Back</Link>
        <p className="mt-5 text-[10px] font-bold uppercase tracking-widest text-white/50">Company campaign</p>
        <h1 className="mt-1 text-2xl font-bold">Commission recurring work</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/60">One ask. Different verified people. A new cycle opens when the target fills.</p>
      </header>
      <form onSubmit={submit} className="space-y-5 px-4 py-5">
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Who is asking</p>
          <label className="mt-3 block text-xs font-semibold text-gray-700">Campaign name<input required name="name" maxLength={80} className={input} placeholder="Weekly release reality check" /></label>
          <label className="mt-3 block text-xs font-semibold text-gray-700">Requester name<input required name="requesterName" maxLength={80} className={input} placeholder="Acme Product" /></label>
          <label className="mt-3 block text-xs font-semibold text-gray-700">What kind of team?<input required name="requesterKind" maxLength={160} className={input} placeholder="The team building Acme's mobile app" /></label>
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">The work</p>
          <label className="mt-3 block text-xs font-semibold text-gray-700">Ask<textarea required name="ask" minLength={20} maxLength={500} rows={4} className={textarea} placeholder="Try the latest release and name the first moment that breaks trust." /></label>
          <label className="mt-3 block text-xs font-semibold text-gray-700">What counts as done, one rule per line<textarea required name="completion" rows={3} className={textarea} placeholder={'Use the current release\nName the exact screen\nExplain what you expected'} /></label>
          <label className="mt-3 block text-xs font-semibold text-gray-700">Proof required<textarea required name="proof" maxLength={300} rows={2} className={textarea} placeholder="A screenshot and one sentence explaining the failure." /></label>
          <label className="mt-3 block text-xs font-semibold text-gray-700">Why this repeats<textarea required name="repeats" maxLength={300} rows={2} className={textarea} placeholder="The answer changes after every release." /></label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-gray-700">Category<select name="category" className={input}><option value="feedback">Feedback</option><option value="review">Review</option><option value="photo">Photo</option><option value="social">Social</option><option value="custom">Custom</option></select></label>
            <label className="text-xs font-semibold text-gray-700">Location<input required name="location" defaultValue="Worldwide" className={input} /></label>
          </div>
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Cycle policy</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-gray-700">People per cycle<input required name="completionsPerCycle" type="number" min="2" max="25" defaultValue="5" className={input} /></label>
            <label className="text-xs font-semibold text-gray-700">Points each<input required name="rewardPoints" type="number" min="1" max="10" defaultValue="5" className={input} /></label>
            <label className="text-xs font-semibold text-gray-700">Cycle hours<input required name="intervalHours" type="number" min="24" max="720" defaultValue="168" className={input} /></label>
            <label className="text-xs font-semibold text-gray-700">Number of cycles<input required name="totalCycles" type="number" min="2" max="12" defaultValue="4" className={input} /></label>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-gray-400">Points only. A wallet can fill one position per cycle. Up to three active campaigns per requester.</p>
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Your media</p>
          <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-3 block w-full text-xs text-gray-500" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return setMediaDataUrl(null);
            if (file.size > 1_000_000) return setError("Campaign media must be 1 MB or smaller.");
            const reader = new FileReader();
            reader.onload = () => setMediaDataUrl(String(reader.result));
            reader.readAsDataURL(file);
          }} />
          {mediaDataUrl ? <img src={mediaDataUrl} alt="Upload preview" className="mt-3 aspect-video w-full rounded-xl object-cover" /> : <p className="mt-3 rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">No image is honest. FAVOUR will show that you did not upload one.</p>}
          {mediaDataUrl && <label className="mt-3 block text-xs font-semibold text-gray-700">Image description<input required name="mediaAlt" maxLength={140} className={input} /></label>}
        </section>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={submitting} className="min-h-14 w-full rounded-xl bg-gray-950 px-4 text-[15px] font-bold text-white disabled:opacity-50">{submitting ? "Creating…" : "Start campaign"}</button>
      </form>
    </main>
  );
}
