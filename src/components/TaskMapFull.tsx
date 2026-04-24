"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Task, TaskStatus } from "@/lib/types";

const STATUS_COLORS: Record<TaskStatus, string> = {
  open: "#22c55e",
  claimed: "#eab308",
  completed: "#3b82f6",
  failed: "#ef4444",
  expired: "#6b7280",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  claimed: "Claimed",
  completed: "Completed",
  failed: "Failed",
  expired: "Expired",
};

function makeIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

function truncate(str: string, len: number) {
  return str.length > len ? str.slice(0, len) + "..." : str;
}

type FilterStatus = TaskStatus | "all";

export default function TaskMapFull() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<FilterStatus>("all");

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) return;
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {
      // silently ignore fetch errors
    }
  }, []);

  // Initial fetch + auto-refresh every 10s
  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10_000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([48.8566, 2.3522], 13);

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19 }
    ).addTo(map);

    L.control.zoom({ position: "topright" }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    markersRef.current = layerGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Update markers when tasks or filter change
  useEffect(() => {
    const group = markersRef.current;
    if (!group) return;

    group.clearLayers();

    const visible = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);

    for (const task of visible) {
      if (task.lat == null || task.lng == null) continue;

      const color =
        task.agent?.color || STATUS_COLORS[task.status] || "#6b7280";
      const icon = makeIcon(color);
      const statusLabel = STATUS_LABELS[task.status] || task.status;

      const popupHtml = `
        <div style="font-family:system-ui,sans-serif;color:#e5e7eb;max-width:220px;">
          <p style="margin:0 0 6px;font-size:13px;line-height:1.4;">${truncate(task.description, 80)}</p>
          <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;">📍 ${task.location}</p>
          <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;">💰 $${task.bountyUsdc} USDC</p>
          <p style="margin:0 0 4px;font-size:11px;">
            <span style="display:inline-block;padding:1px 6px;border-radius:9999px;font-size:10px;font-weight:600;background:${STATUS_COLORS[task.status]}22;color:${STATUS_COLORS[task.status]};">${statusLabel}</span>
          </p>
          ${task.agent ? `<p style="margin:0 0 4px;font-size:11px;color:#9ca3af;">🤖 ${task.agent.name}</p>` : ""}
          <a href="/task/${task.id}" style="display:inline-block;margin-top:6px;font-size:11px;color:#60a5fa;text-decoration:underline;">View task &rarr;</a>
        </div>
      `;

      L.marker([task.lat, task.lng], { icon })
        .bindPopup(popupHtml, {
          className: "dark-popup",
          closeButton: true,
          maxWidth: 240,
        })
        .addTo(group);
    }
  }, [tasks, filter]);

  const visibleTasks =
    filter === "all" ? tasks : tasks.filter((t) => t.status === filter);
  const geoTasks = visibleTasks.filter(
    (t) => t.lat != null && t.lng != null
  );
  const totalBounty = geoTasks.reduce((sum, t) => sum + t.bountyUsdc, 0);

  const filters: { label: string; value: FilterStatus; color: string }[] = [
    { label: "All", value: "all", color: "#ffffff" },
    { label: "Open", value: "open", color: STATUS_COLORS.open },
    { label: "Claimed", value: "claimed", color: STATUS_COLORS.claimed },
    { label: "Completed", value: "completed", color: STATUS_COLORS.completed },
  ];

  return (
    <div className="relative w-full h-full">
      {/* Filter bar */}
      <div className="absolute top-3 left-3 right-14 z-[1000] flex gap-1 sm:gap-1.5 overflow-x-auto">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className="px-2.5 sm:px-3 py-1.5 rounded-full text-[10px] sm:text-[11px] font-semibold transition-all border shrink-0 min-h-[36px]"
            style={{
              background:
                filter === f.value ? f.color + "22" : "rgba(0,0,0,0.6)",
              color: filter === f.value ? f.color : "#9ca3af",
              borderColor:
                filter === f.value ? f.color + "55" : "rgba(255,255,255,0.1)",
              backdropFilter: "blur(8px)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Stats overlay */}
      <div
        className="absolute bottom-4 left-3 z-[1000] rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-[10px] sm:text-[11px] border border-white/10"
        style={{
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="text-gray-400">
          <span className="text-white font-semibold">{geoTasks.length}</span>{" "}
          tasks on map
        </div>
        <div className="text-gray-400 mt-0.5">
          <span className="text-green-400 font-semibold">
            ${totalBounty.toFixed(2)}
          </span>{" "}
          total bounty
        </div>
      </div>

      {/* Map container */}
      <div ref={mapRef} className="w-full h-full" />

      {/* Dark popup styles */}
      <style jsx global>{`
        .dark-popup .leaflet-popup-content-wrapper {
          background: rgba(15, 15, 15, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        }
        .dark-popup .leaflet-popup-tip {
          background: rgba(15, 15, 15, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .dark-popup .leaflet-popup-close-button {
          color: #9ca3af !important;
        }
        .dark-popup .leaflet-popup-close-button:hover {
          color: #fff !important;
        }
      `}</style>
    </div>
  );
}
