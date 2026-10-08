"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FirstPage } from "@/lib/first-page";
import type { Launch } from "@/lib/launch-feed";
import { TopProducts } from "./TopProducts";
import { VoteList } from "./VoteList";

// `TopProducts` WITH ITS DATA. DESIGN-SYSTEM.md, Flow 1, step 1. This is the one
// line a first page needs: <TopProductsLive />. It reads /api/top and shows the
// four states: loading, error, empty and filled (`TopProducts` owns the last two).
//
// A tap on a product on FAVOUR opens its product screen, /p/<id>. "Post your own
// app" opens /post. A tap on an outside launch opens the product's own page in a
// new tab: the maker asked FAVOUR for nothing, so FAVOUR has no screen for it.
//
// Mounted at the top of the Campaigns tab in Feed.tsx.

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; page: FirstPage };

export function TopProductsLive({
  onOpen, onPost, onOpenLaunch,
}: {
  onOpen?: (id: string) => void;
  onPost?: () => void;
  onOpenLaunch?: (launch: Launch) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    fetch("/api/top")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data?.top) throw new Error("unreadable");
        return data as FirstPage;
      })
      .then((page) => { if (live) setState({ kind: "ready", page }); })
      .catch(() => { if (live) setState({ kind: "error" }); });
    return () => { live = false; };
  }, [attempt]);

  if (state.kind === "loading") {
    return <p role="status" className="px-4 py-6 text-sm text-gray-600">Reading today&apos;s products…</p>;
  }
  if (state.kind === "error") {
    return (
      <div role="alert" className="px-4 py-6">
        <p className="text-sm text-gray-600">Today&apos;s products could not be read.</p>
        <button
          type="button"
          className="mt-3 min-h-[44px] w-full rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 active:scale-[0.98]"
          onClick={() => { setState({ kind: "loading" }); setAttempt((n) => n + 1); }}
        >
          Try again
        </button>
      </div>
    );
  }
  const { top, launches, pictures } = state.page;
  return (
    <>
    <TopProducts
      top={top}
      launches={launches}
      pictures={pictures}
      onOpen={onOpen ?? ((id) => router.push(`/p/${encodeURIComponent(id)}`))}
      onPost={onPost ?? (() => router.push("/post"))}
      onOpenLaunch={onOpenLaunch ?? ((l) => { window.open(l.url, "_blank", "noopener,noreferrer"); })}
    />
    {/* Under the day's list: real products a person can vote for. */}
    <VoteList />
    </>
  );
}
