// Requester imagery and submitted proof are two different things (2026-09-09).
//
// A campaign may carry an image the requester uploaded themselves. That is real
// permitted media and it renders as such, credited to the requester. Where no
// such image exists, this draws a flat category mark in CSS and SVG. It is
// labelled as an illustration in words, every time, because the one thing it
// must never be mistaken for is a photograph of this favour or anybody's proof.
//
// Compare with ProofSlot, which draws the shape of proof that does NOT exist
// yet. These two never swap roles: art goes at the top as identification, the
// proof slot stays where the requirement is stated.

const MARKS: Record<string, { title: string; path: React.ReactNode }> = {
  photo: {
    title: "A photo favour",
    path: (
      <>
        <rect x="8" y="16" width="48" height="36" rx="5" />
        <circle cx="32" cy="34" r="9" />
        <path d="M22 16l4-6h12l4 6" />
      </>
    ),
  },
  "check-in": {
    title: "A check-in favour",
    path: (
      <>
        <path d="M32 8c9 0 16 7 16 16 0 12-16 32-16 32S16 36 16 24c0-9 7-16 16-16z" />
        <circle cx="32" cy="24" r="6" />
      </>
    ),
  },
  feedback: {
    title: "An opinion favour",
    path: (
      <>
        <path d="M10 14h44v30H32L20 54V44H10z" />
        <path d="M20 26h24M20 34h16" />
      </>
    ),
  },
  delivery: {
    title: "A delivery favour",
    path: (
      <>
        <path d="M8 22l24-12 24 12v22L32 56 8 44z" />
        <path d="M8 22l24 12 24-12M32 34v22" />
      </>
    ),
  },
};

function markFor(category: string) {
  return MARKS[category] ?? MARKS.feedback;
}

export function CategoryArt({
  category,
  media,
}: {
  category: string;
  media?: { url: string; alt: string } | null;
}) {
  if (media) {
    return (
      <figure className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <img src={media.url} alt={media.alt} className="aspect-video w-full object-cover" />
        <figcaption className="px-4 py-2.5 text-[11px] leading-relaxed text-gray-500">
          Uploaded by the requester to describe the ask. It is not proof, and it
          is not anyone&apos;s completed work.
        </figcaption>
      </figure>
    );
  }

  const mark = markFor(category);
  return (
    <figure className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="flex h-32 w-full items-center justify-center bg-gray-950">
        <svg
          width="64"
          height="64"
          viewBox="0 0 64 64"
          fill="none"
          stroke="rgb(255,255,255)"
          strokeOpacity="0.55"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label={mark.title}
        >
          {mark.path}
        </svg>
      </div>
      <figcaption className="px-4 py-2.5 text-[11px] leading-relaxed text-gray-500">
        Drawn illustration of the category, because the requester uploaded no
        image. It is not a photograph of this favour and not anyone&apos;s proof.
      </figcaption>
    </figure>
  );
}
