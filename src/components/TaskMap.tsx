"use client";

import { useEffect, useRef } from "react";
import type { Task } from "@/lib/types";

const CATEGORY_ICONS: Record<string, string> = {
  photo: "📸",
  delivery: "📦",
  "check-in": "📍",
  custom: "✏️",
};

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

        const icon = CATEGORY_ICONS[task.category] || "✏️";
        const color = task.status === "open" ? "#22c55e" : task.status === "claimed" ? "#f59e0b" : "#3b82f6";

        const taskIcon = L.divIcon({
          html: `<div style="background:${color};color:white;border-radius:12px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;gap:4px;"><span>${icon}</span> $${task.bountyUsdc}</div>`,
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
