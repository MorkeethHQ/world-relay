import { proofRequirement } from "@/lib/proof-requirement";

// THE SIGNATURE DEVICE (2026-09-09).
//
// FAVOUR's subject is one real person doing one small real task and proving it.
// The slot is the shape of that proof before it exists: an empty frame for a
// photo, ruled empty lines for an answer. It is drawn in CSS, never filled with
// stock art, and it is empty because nobody has done this favour yet.
//
// It is not decoration. Remove it and the screen loses the proof requirement,
// which is the exact thing a stranger gets wrong about a two-sided market.
// Once a proof is submitted the real image renders elsewhere (Feed, History);
// this device only ever shows the empty case.
//
// No animation. A twinkling status dot is a tell, and FAVOUR shipped one once.

export function ProofSlot({
  category,
  size = "md",
}: {
  category: string;
  size?: "sm" | "md";
}) {
  const req = proofRequirement(category);
  const pad = size === "sm" ? "px-4 py-4" : "px-5 py-5";
  return (
    <div className={`rounded-2xl border border-dashed border-gray-300 bg-white ${pad}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
        Proof required
      </p>
      <p className="mt-2 text-[15px] font-semibold leading-snug text-gray-900">
        {req.label}
      </p>

      {req.shape === "frame" ? (
        <div
          aria-hidden="true"
          className="mt-4 flex h-28 w-full items-center justify-center rounded-xl border border-gray-200 bg-gray-50"
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="rgb(203,211,220)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="15" rx="2.5" />
            <circle cx="12" cy="12.5" r="3.5" />
            <path d="M8 5l1.4-2h5.2L16 5" />
          </svg>
        </div>
      ) : (
        <div aria-hidden="true" className="mt-4 space-y-2.5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
          <span className="block h-2 w-full rounded-full bg-gray-200" />
          <span className="block h-2 w-11/12 rounded-full bg-gray-200" />
          <span className="block h-2 w-2/3 rounded-full bg-gray-200" />
        </div>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
        This slot is empty because nobody has done this favour yet. FAVOUR never
        fills it with stock art.
      </p>
    </div>
  );
}
