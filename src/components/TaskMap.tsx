"use client";

import { useEffect, useRef } from "react";
import type { Task } from "@/lib/types";
import { isPointsReward, isRealMoney } from "@/lib/reward";

// Inner SVG markup (paths only) mirroring <CategoryIcon>, for the raw-HTML
// Leaflet markers. SVG-only: no rendered emoji anywhere on the map.
const CATEGORY_ICON_PATHS: Record<string, string> = {
  photo:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  delivery:
    '<path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/>',
  "check-in":
    '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  feedback:
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  review:
    '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  social:
    '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>',
  errand:
    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
};

const DEFAULT_ICON_PATH =
  '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>';

// Marker reward label via the canonical helpers. $ is shown ONLY for
// escrow-funded tasks so a marker can never imply money that is not escrowed.
function markerRewardLabel(task: Task): string {
  if (isPointsReward(task)) return `${Math.round(task.bountyUsdc)} pts`;
  if (isRealMoney(task)) return `$${task.bountyUsdc}`;
  return `${task.bountyUsdc} USDC`;
}

function categoryIconSvg(category: string): string {
  const inner = CATEGORY_ICON_PATHS[category] || DEFAULT_ICON_PATH;
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

export function TaskMap({
  tasks,
  userLocation,
  onSelectTask,
}: {
  tasks: Task[];
  userLocation: { lat: number; lng: number } | null;
  onSelectTask: (task: Task) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      if (cancelled || !mapRef.current) return;

      const center = userLocation
        ? [userLocation.lat, userLocation.lng] as [number, number]
        : [48.8566, 2.3522] as [number, number]; // Paris default

      const map = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView(center, 13);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(map);

      // User location marker
      if (userLocation) {
        const userIcon = L.divIcon({
          html: `<div style="width:12px;height:12px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 0 8px rgba(59,130,246,0.5);"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
          className: "",
        });
        L.marker([userLocation.lat, userLocation.lng], { icon: userIcon }).addTo(map);
      }

      // Task markers
      for (const task of tasks) {
        if (!task.lat || !task.lng) continue;

        const icon = categoryIconSvg(task.category);
        const color = task.status === "open" ? "#22c55e" : task.status === "claimed" ? "#f59e0b" : "#3b82f6";
        const rewardLabel = markerRewardLabel(task);

        const taskIcon = L.divIcon({
          html: `<div style="background:${color};color:white;border-radius:12px;padding:2px 8px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;gap:4px;"><span style="display:inline-flex;align-items:center;">${icon}</span> ${rewardLabel}</div>`,
          iconSize: [0, 0],
          iconAnchor: [30, 15],
          className: "",
        });

        L.marker([task.lat, task.lng], { icon: taskIcon })
          .addTo(map)
          .on("click", () => onSelectTask(task));
      }

      mapInstanceRef.current = map;
    })();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [tasks, userLocation, onSelectTask]);

  return (
    <div
      ref={mapRef}
      className="w-full rounded-2xl overflow-hidden border border-white/[0.06]"
      style={{ height: "calc(100vh - 200px)", minHeight: "400px" }}
    />
  );
}
