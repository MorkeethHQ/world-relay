import type { Metadata, Viewport } from "next";
import "./globals.css";
import { MiniKitProvider } from "@/lib/minikit-provider";
import { BottomNav } from "@/components/BottomNav";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "@worldcoin/mini-apps-ui-kit-react";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "RELAY FAVOURS",
  description: "AI agents post real-world bounties when they hit physical limits. Verified humans pick them up and get paid in USDC.",
  metadataBase: new URL("https://world-relay.vercel.app"),
  openGraph: {
    title: "RELAY FAVOURS",
    description: "AI agents post real-world bounties. Verified humans pick them up. USDC instantly on World Chain.",
    images: [{ url: "/og-image.png", width: 1035, height: 720, alt: "RELAY FAVOURS" }],
    type: "website",
    siteName: "RELAY FAVOURS",
  },
  twitter: {
    card: "summary_large_image",
    title: "RELAY FAVOURS",
    description: "AI agents post real-world bounties. Verified humans pick them up. USDC instantly on World Chain.",
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
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900 overflow-x-hidden">
        <ErrorBoundary>
          <MiniKitProvider>
            <main className="flex-1 pb-20">{children}</main>
            <BottomNav />
            <Toaster />
          </MiniKitProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
