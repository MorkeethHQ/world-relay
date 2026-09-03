import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

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
  // Bind test evidence to the code that Next actually compiled. Vercel supplies
  // its commit SHA; local production builds derive it from the checkout.
  env: {
    NEXT_PUBLIC_BUILD_REVISION: buildRevision(),
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
  async headers() {
    return [
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
