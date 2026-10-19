import type { DeckCard } from "@/lib/deck-view";
import { funkyArt } from "@/lib/funky-art";
import { TenHumans } from "@/components/fv/TenHumans";

// ONE CARD OF THE DECK. The picture is the top half: the product's own picture,
// or the funky art drawn from its name. Under it: the name (framed when found
// elsewhere), one line, who made it and where it came from, and the one number
// that matters for this card.
export function DeckCardView({ c }: { c: DeckCard }) {
  const pic = c.image ?? funkyArt(c.name);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={pic} alt="" className="fv-deck-pic" draggable={false} />
      {c.foundElsewhere && <p className="fv-banner fv-label fv-rule-b">Found elsewhere</p>}
      <div className="p-4 flex flex-col gap-2 flex-1 min-h-0">
        <h2 className={`fv-title break-words line-clamp-2 ${c.foundElsewhere ? "fv-frame" : ""}`}>{c.name}</h2>
        {c.line && <p className="fv-body break-words line-clamp-3">{c.line}</p>}
        <p className="fv-body text-[12px] break-all">
          by {c.maker} · {c.from}{c.host ? ` · ${c.host}` : ""}
        </p>
        <div className="mt-auto flex flex-col gap-2">
          {c.source === "hn" ? (
            <p className="fv-body fv-num text-[12px]">{c.hnPoints} points · {c.hnComments} comments on Hacker News · talk about it, no favour</p>
          ) : c.live ? (
            <p className="fv-h fv-num">{c.usd ? `${c.usd} USDC per review` : `${c.points} points per review`}</p>
          ) : c.projectId ? (
            <>
              <TenHumans yes={c.yes} of={c.of} />
              <p className="fv-body fv-num text-[12px]">{c.yes} of {c.of} said YES. Ten puts it live.</p>
            </>
          ) : (
            <p className="fv-body text-[12px]">Not on FAVOUR yet. Try it and tell Oscar.</p>
          )}
        </div>
      </div>
    </>
  );
}
