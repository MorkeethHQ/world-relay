"use client";

import { QRCodeSVG } from "qrcode.react";
import { worldAppUrl } from "@/lib/world-app-link";

interface WorldAppHandoffProps {
  className?: string;
}

/**
 * Browser-to-phone handoff. The universal link opens FAVOUR in World App on a
 * phone; the QR keeps that same one-step path available on a desktop.
 */
export function WorldAppHandoff({ className = "" }: WorldAppHandoffProps) {
  const href = worldAppUrl();
  if (!href) return null;

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <a
        href={href}
        className="min-h-[44px] inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-[14px] font-semibold text-gray-900 active:scale-[0.98]"
      >
        Open in World App
      </a>

      <div className="desktop-handoff-qr flex-col items-center gap-2" aria-label="Scan to open FAVOUR in World App">
        <div className="rounded-2xl border border-gray-200 bg-white p-3">
          <QRCodeSVG
            value={href}
            size={112}
            bgColor="#ffffff"
            fgColor="#191c20"
            level="M"
            title="Open FAVOUR in World App"
          />
        </div>
        <p className="text-[12px] text-gray-400">Scan with your phone</p>
      </div>
    </div>
  );
}
