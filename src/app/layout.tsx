import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { MiniKitProvider } from "@/lib/minikit-provider";
import { BottomNav } from "@/components/BottomNav";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "@worldcoin/mini-apps-ui-kit-react";
import { PageTracker } from "@/components/PageTracker";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "FAVOUR",
  description: "Ask favours, complete tasks, earn USDC. AI verifies everything instantly. Inside World App.",
  metadataBase: new URL("https://world-relay.vercel.app"),
  openGraph: {
    title: "FAVOUR",
    description: "Ask favours, complete tasks, earn USDC. AI verifies everything. Inside World App.",
    images: [{ url: "/og-image.png", width: 1035, height: 720, alt: "FAVOUR" }],
    type: "website",
    siteName: "FAVOUR",
  },
  twitter: {
    card: "summary_large_image",
    title: "FAVOUR",
    description: "Ask favours, complete tasks, earn USDC. AI verifies everything. Inside World App.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      {/* No `overflow-x-hidden` here on purpose. On <body> it propagates to the
          viewport instead of clipping in place, so it never actually contained
          anything — it only hid the symptom on desktop while iOS still widened
          its layout viewport. The containment is on <main> below; without the
          decoy, a real overflow now shows up as a scrollbar in development. */}
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <ErrorBoundary>
          <MiniKitProvider>
            {/* Shown only in the local TEST DATA fixture (scripts/REVIEW-FIXTURE.md).
                The variable is not set in any deployed environment. */}
            {process.env.NEXT_PUBLIC_FAVOUR_TEST_FIXTURE === "1" && (
              <div role="note" className="pointer-events-none fixed top-1 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-amber-600 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white whitespace-nowrap">
                Test data · local preview
              </div>
            )}
            <PageTracker />
            {/* `viewport-clip`: contains horizontal overflow here, in place, so
                it can never widen the iOS layout viewport and drag the fixed
                BottomNav off the screen. See the comment in globals.css. */}
            <main className="viewport-clip flex-1 pb-20">{children}</main>
            <BottomNav />
            <Toaster />
          </MiniKitProvider>
          <Analytics />
        </ErrorBoundary>
      </body>
    </html>
  );
}
