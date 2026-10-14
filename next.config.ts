import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import { fixtureStoreOrigin } from "./src/lib/test-fixture";

function buildRevision(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["@xmtp/node-sdk", "@xmtp/node-bindings"],
  // The dev-only indicator sits bottom-left, on top of the Favours tab at phone
  // width, so a tap on the tab opened the dev menu instead (review, 5 Oct 2026).
  // It never exists in a production build; this only clears it in `next dev`.
  devIndicators: false,
  // Bind test evidence to the code that Next actually compiled. Vercel supplies
  // its commit SHA; local production builds derive it from the checkout.
  env: {
    NEXT_PUBLIC_BUILD_REVISION: buildRevision(),
    // "production", "preview" or "" (local). The jury game switch reads it, so a
    // branch preview shows the game and production does not (lib/jury-game.ts).
    NEXT_PUBLIC_FAVOUR_DEPLOY_ENV: process.env.VERCEL_ENV ?? "",
  },
  // Never CDN-cache the HTML documents. The app is a client-rendered SPA whose
  // shell was getting pinned to an old bundle at the edge (x-vercel-cache HIT),
  // so fresh deploys weren't reaching the World App webview. Static assets under
  // /_next/static/ remain immutable-cached (untouched here).
  // /leaderboard ("Ranks") was removed 2026-09-03. Old deep links and the
  // agent discovery doc pointed at it; send them to the profile, not a 404.
  async redirects() {
    return [{ source: "/leaderboard", destination: "/dashboard", permanent: true }];
  },
  // THE LOCAL TEST DATA FIXTURE ONLY (2026-10-05). When the app runs against the
  // in-memory fake store on 127.0.0.1 with FAVOUR_TEST_FIXTURE=1 and is not a
  // production build, /__fixture/* is passed to the fake's sign-in helper so a
  // reviewer can act as a TEST wallet in a browser. fixtureStoreOrigin answers
  // null in every other case, and then no rewrite exists at all.
  async rewrites() {
    const origin = fixtureStoreOrigin();
    return origin ? [{ source: "/__fixture/:path*", destination: `${origin}/__fixture/:path*` }, { source: "/__fixture", destination: `${origin}/__fixture/` }] : [];
  },
  async headers() {
    return [
      // PAGE LOCK (hardening pass, 2026-10-13). Production answered GET / with
      // no frame, sniff, referrer or CSP header on 2026-10-12.
      //
      // Frames are refused everywhere. FAVOUR runs inside World App, and
      // docs.world.org/mini-apps/more/webview-spec (read 2026-10-12) says the
      // app is opened in a native WebView (Android WebView, iOS WKWebView),
      // which is a top-level context and not a frame, so 'none' is safe there.
      // The enforced CSP carries frame-ancestors ONLY: it cannot break a script
      // or an image. The full policy below is REPORT-ONLY until it has been
      // read in World App with zero violations (rollout step on the hardening
      // page); only then does it move to the enforced header.
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              // Next.js hydrates with inline scripts; a nonce or hash scheme is
              // the step after report-only shows this list is complete.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              // Proof photos: data: URLs from the store, Vercel Blob uploads,
              // and the streaming path on this origin. Map tiles from Carto.
              "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://*.basemaps.cartocdn.com",
              // Usernames are resolved client side (src/hooks/useWorldUser.ts).
              "connect-src 'self' https://usernames.worldcoin.org",
              "font-src 'self' data:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        source: "/(dashboard|agent)",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        source: "/task/:id*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
