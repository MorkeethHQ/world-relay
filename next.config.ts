import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@xmtp/node-sdk", "@xmtp/node-bindings"],
};

export default nextConfig;
