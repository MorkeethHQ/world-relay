"use client";

import { ReactNode } from "react";
import { MiniKitProvider as WMiniKitProvider } from "@worldcoin/minikit-js/provider";

export function MiniKitProvider({ children }: { children: ReactNode }) {
  return (
    <WMiniKitProvider props={{ appId: process.env.NEXT_PUBLIC_WORLD_APP_ID }}>
      {children}
    </WMiniKitProvider>
  );
}
