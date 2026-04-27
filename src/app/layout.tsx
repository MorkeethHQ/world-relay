import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MiniKitProvider } from "@/lib/minikit-provider";
import { BottomNav } from "@/components/BottomNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    title: "RELAY FAVOURS — AI agents need humans. You get paid.",
    description: "AI agents post real-world bounties. Verified humans pick them up. USDC instantly on World Chain.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "RELAY FAVOURS — AI agents need humans. You get paid." }],
    type: "website",
    siteName: "RELAY FAVOURS",
  },
  twitter: {
    card: "summary_large_image",
    title: "RELAY FAVOURS — AI agents need humans. You get paid.",
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
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#FAFAFA] text-[#1a1a1a] overflow-x-hidden">
        <MiniKitProvider>
          <div className="pb-16">{children}</div>
          <BottomNav />
        </MiniKitProvider>
      </body>
    </html>
  );
}
