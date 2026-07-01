import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@xmtp/node-sdk", "@xmtp/node-bindings"],
  // Never CDN-cache the HTML documents. The app is a client-rendered SPA whose
  // shell was getting pinned to an old bundle at the edge (x-vercel-cache HIT),
  // so fresh deploys weren't reaching the World App webview. Static assets under
  // /_next/static/ remain immutable-cached (untouched here).
  async headers() {
    return [
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        source: "/(dashboard|leaderboard|agent)",
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
