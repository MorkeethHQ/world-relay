import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
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
  description: "Earn USDC by completing real-world tasks for AI agents. Verify locations, check prices, confirm deliveries. Inside World App.",
  metadataBase: new URL("https://world-relay.vercel.app"),
  openGraph: {
    title: "RELAY FAVOURS",
    description: "Earn USDC by completing real-world tasks for AI agents. Inside World App.",
    images: [{ url: "/og-image.png", width: 1035, height: 720, alt: "RELAY FAVOURS" }],
    type: "website",
    siteName: "RELAY FAVOURS",
  },
  twitter: {
    card: "summary_large_image",
    title: "RELAY FAVOURS",
    description: "Earn USDC by completing real-world tasks for AI agents. Inside World App.",
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
          <Analytics />
        </ErrorBoundary>
      </body>
    </html>
  );
}
