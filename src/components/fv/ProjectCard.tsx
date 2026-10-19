import Link from "next/link";
import type { ProjectCard as Card } from "@/lib/projects-view";
import { countLine } from "@/lib/projects-view";
import { TenHumans } from "@/components/fv/TenHumans";

// One project on the picker. The picture bleeds inside the rule, the title sits
// in a frame when the project was found elsewhere, and the ten-cell row says how
// far it is from live. The count is the server's count.
export function ProjectCard({ p, busy, note, onYes }: { p: Card; busy: boolean; note?: string; onYes: (id: string) => void }) {
  const live = p.status === "published";
  return (
    <article data-project={p.id} className="fv-box flex flex-col">
      {p.fromOtherSource && <p className="fv-banner fv-label fv-rule-b">Found elsewhere</p>}
      {p.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt="" className="fv-pic" />
      )}
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={`fv-h break-words ${p.fromOtherSource ? "fv-frame" : ""}`}>{p.name}</h2>
            {p.host && <p className="fv-body text-[12px] mt-1 break-all">{p.host}</p>}
          </div>
          <p className={`fv-h fv-num shrink-0 ${live ? "" : "fv-blue"}`}>{countLine(p)}</p>
        </div>
        <p className="fv-body break-words line-clamp-3">{p.ask}</p>
        <TenHumans yes={p.yes} of={p.of} />
        <div className="flex gap-2">
          <Link href={`/project/${encodeURIComponent(p.id)}`} className="fv-btn fv-btn-sm flex-1">{live ? "Give feedback" : "Open"}</Link>
          {!live && (
            <button type="button" disabled={busy} aria-label={`Say YES to ${p.name}`} onClick={() => onYes(p.id)} className="fv-btn fv-btn-sm fv-btn-ink flex-1">YES</button>
          )}
        </div>
        {note && <p role="status" className="fv-body">{note}</p>}
      </div>
    </article>
  );
}
